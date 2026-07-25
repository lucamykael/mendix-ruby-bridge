# frozen_string_literal: true

require "json"
require "open3"
require "tempfile"
require "time"
require "webrick"

module MendixBridge
  class BackendServerError < StandardError; end

  class BackendServer
    INVENTORY_FILES = {
      "/inventory/project-tree.json" => ["inventory", "project-tree.json"],
      "/inventory/element-details.json" => ["inventory", "element-details.json"],
      "/inventory/dependencies.json" => ["inventory", "dependencies.json"],
      "/inventory/mendix-project.json" => ["mendix-project.json"],
      "/inventory/ui-layouts.json" => ["inventory", "ui-layouts.json"]
    }.freeze

    attr_reader :port

    def initialize(
      inventory_dir:,
      web_root:,
      mxcli:,
      bind: "127.0.0.1",
      port: 4567,
      logger: nil
    )
      @inventory_dir = File.expand_path(inventory_dir)
      @web_root = File.expand_path(web_root)
      @mxcli = File.expand_path(mxcli)
      @layout_mutex = Mutex.new
      validate!
      @server = WEBrick::HTTPServer.new(
        BindAddress: bind,
        Port: port,
        Logger: logger || WEBrick::Log.new(File::NULL),
        AccessLog: []
      )
      @port = @server.listeners.first.addr[1]
      mount_routes
    end

    def start
      @server.start
    end

    def shutdown
      @server.shutdown
    end

    private

    def validate!
      tree = File.join(@inventory_dir, "inventory", "project-tree.json")
      raise BackendServerError, "not an imported inventory: #{@inventory_dir}" unless
        File.file?(tree)
      raise BackendServerError, "frontend build does not exist: #{@web_root}" unless
        File.file?(File.join(@web_root, "index.html"))
      raise BackendServerError, "mxcli is not executable: #{@mxcli}" unless
        File.executable?(@mxcli)
    end

    def mount_routes
      @server.mount_proc("/inventory") { |request, response| inventory(request, response) }
      @server.mount_proc("/api/health") { |_request, response| health(response) }
      @server.mount_proc("/api/layout") { |request, response| layout(request, response) }
      @server.mount_proc("/api/entity-plan") do |request, response|
        entity_plan(request, response)
      end
      @server.mount_proc("/api/marketplace/search") do |request, response|
        marketplace_search(request, response)
      end
      @server.mount_proc("/api/marketplace/item") do |request, response|
        marketplace_item(request, response)
      end
      @server.mount_proc("/api/git") { |request, response| git_route(request, response) }
      @server.mount_proc("/api/page") { |request, response| page_route(request, response) }
      @server.mount_proc("/api/flow") { |request, response| flow_route(request, response) }
      @server.mount_proc("/api/drafts") { |_request, response| drafts(response) }
      @server.mount_proc("/api/apply") { |request, response| apply_draft_route(request, response) }
      @server.mount_proc("/api/marketplace/install") do |request, response|
        marketplace_install(request, response)
      end
      @server.mount(
        "/",
        WEBrick::HTTPServlet::FileHandler,
        @web_root,
        FancyIndexing: false
      )
    end

    def inventory(request, response)
      relative = INVENTORY_FILES[request.path]
      return json(response, { error: "not found" }, status: 404) unless relative

      path = File.join(@inventory_dir, *relative)
      if request.path == "/inventory/ui-layouts.json" && !File.file?(path)
        return json(response, {})
      end
      return json(response, { error: "not found" }, status: 404) unless File.file?(path)

      response.status = 200
      response["content-type"] = "application/json; charset=utf-8"
      response["cache-control"] = "no-store"
      response.body = File.binread(path)
    end

    def health(response)
      metadata_path = File.join(@inventory_dir, "mendix-project.json")
      metadata = File.file?(metadata_path) ? JSON.parse(File.read(metadata_path)) : {}
      json(
        response,
        {
          ok: true,
          version: MendixBridge::VERSION,
          element_count: metadata["element_count"],
          imported_at: metadata["imported_at"],
          capabilities: {
            inventory: true,
            dependencies: File.file?(
              File.join(@inventory_dir, "inventory", "dependencies.json")
            ),
            layout_persistence: true,
            visual_entity_plans: true,
            marketplace_install: source_project ? true : false,
            git: git_workflow ? true : false,
            page_drafts: true,
            flow_drafts: true,
            apply_drafts: source_project ? true : false
          }
        }
      )
    end

    def layout(request, response)
      return json(response, { error: "method not allowed" }, status: 405) unless
        request.request_method == "POST"

      payload = JSON.parse(request.body.to_s)
      qn = payload.fetch("qn")
      positions = payload.fetch("positions")
      unless qn.is_a?(String) && qn.match?(/\A[A-Za-z_]\w*\.[A-Za-z_]\w*\z/)
        return json(response, { error: "invalid qualified name" }, status: 422)
      end
      unless positions.is_a?(Array) && positions.all? { |position| valid_position?(position) }
        return json(response, { error: "invalid node positions" }, status: 422)
      end
      details_path = File.join(@inventory_dir, "inventory", "element-details.json")
      details = JSON.parse(File.read(details_path))
      return json(response, { error: "unknown element" }, status: 404) unless details.key?(qn)

      path = File.join(@inventory_dir, "inventory", "ui-layouts.json")
      @layout_mutex.synchronize do
        layouts = File.file?(path) ? JSON.parse(File.read(path)) : {}
        layouts[qn] = positions
        temporary = "#{path}.tmp"
        File.write(temporary, "#{JSON.pretty_generate(layouts)}\n")
        File.rename(temporary, path)
      end
      preview = positions.map do |position|
        "@position(#{position.fetch('x').round}, #{position.fetch('y').round}) " \
          "#{position.fetch('label')}"
      end.join("\n")
      json(
        response,
        {
          ok: true,
          persisted: true,
          message: "Layout positions saved in the Ruby inventory.",
          mdlPreview: preview
        }
      )
    rescue JSON::ParserError, KeyError
      json(response, { error: "invalid JSON payload" }, status: 400)
    end

    def marketplace_search(request, response)
      query = request.query["q"].to_s
      limit = [[request.query["limit"].to_i, 1].max, 100].min
      output = run_mxcli(
        "marketplace", "search", query,
        "--limit", limit.to_s,
        "--json"
      )
      data = JSON.parse(output)
      json(response, normalize_marketplace(data))
    rescue BackendServerError => error
      json(response, { error: error.message }, status: 502)
    rescue JSON::ParserError
      json(response, { error: "mxcli returned invalid marketplace JSON" }, status: 502)
    end

    def entity_plan(request, response)
      return json(response, { error: "method not allowed" }, status: 405) unless
        request.request_method == "POST"

      payload = JSON.parse(request.body.to_s)
      inventory = Inventory.load(
        File.join(@inventory_dir, "inventory", "project-tree.json"),
        details_path: File.join(@inventory_dir, "inventory", "element-details.json")
      )
      result = VisualEntityPlan.build(inventory:, payload:)
      persist_visual_plan(payload.fetch("qn"), payload, result)
      json(response, result)
    rescue JSON::ParserError, KeyError
      json(response, { error: "invalid JSON payload" }, status: 400)
    rescue ArgumentError => error
      json(response, { error: error.message }, status: 422)
    end

    def marketplace_item(request, response)
      id = request.path.delete_prefix("/api/marketplace/item/")
      return json(response, { error: "invalid marketplace id" }, status: 422) unless
        id.match?(/\A\d+\z/)

      output = run_mxcli("marketplace", "info", id, "--json")
      json(response, normalize_marketplace_item(JSON.parse(output)))
    rescue BackendServerError => error
      json(response, { error: error.message }, status: 502)
    rescue JSON::ParserError
      json(response, { error: "mxcli returned invalid marketplace JSON" }, status: 502)
    end

    # Guarded Git operations for the imported Mendix project, surfaced to the
    # viewer. Mutating actions require `studio_closed: true` (Studio Pro locks
    # the .mpr), matching bin/mendix-git. Returns 503 when the Git/Mendix
    # toolchain is unavailable so the frontend can hide the panel.
    def git_route(request, response)
      workflow = git_workflow
      return json(response, { error: git_workflow_error }, status: 503) unless workflow

      action = request.path.delete_prefix("/api/git").sub(%r{\A/}, "")
      post = request.request_method == "POST"
      payload = post && !request.body.to_s.empty? ? JSON.parse(request.body.to_s) : {}
      closed = payload["studio_closed"] == true

      result =
        case [request.request_method, action]
        when ["GET", "status"] then workflow.status
        when ["GET", "branches"] then { "branches" => workflow.branches, "current" => workflow.status["branch"] }
        when ["GET", "stash"] then { "stash" => workflow.stash_list.lines.map(&:strip).reject(&:empty?) }
        when ["POST", "fetch"] then workflow.fetch && workflow.status
        when ["POST", "switch"] then workflow.switch(payload.fetch("branch"), studio_closed: closed)
        when ["POST", "create"] then workflow.create(payload.fetch("branch"), studio_closed: closed)
        when ["POST", "commit"] then workflow.commit(payload.fetch("message"), studio_closed: closed)
        when ["POST", "stash"]
          workflow.stash_push(
            studio_closed: closed,
            message: payload["message"],
            include_untracked: payload["include_untracked"] == true
          )
        when ["POST", "stash/apply"]
          workflow.stash_apply(
            payload.fetch("reference", "stash@{0}"),
            studio_closed: closed,
            drop: payload["drop"] == true
          )
        when ["POST", "stash/drop"]
          { "dropped" => workflow.stash_drop(payload.fetch("reference", "stash@{0}")) }
        else
          return json(response, { error: "unknown git action" }, status: 404)
        end

      json(response, result)
    rescue KeyError => error
      json(response, { error: "missing parameter: #{error.key}" }, status: 400)
    rescue JSON::ParserError
      json(response, { error: "invalid JSON payload" }, status: 400)
    rescue GitWorkflowError => error
      json(response, { error: error.message }, status: 409)
    end

    def git_workflow
      return @git_workflow if defined?(@git_workflow)

      @git_workflow_error = nil
      metadata_path = File.join(@inventory_dir, "mendix-project.json")
      source = File.file?(metadata_path) ? JSON.parse(File.read(metadata_path))["source_project"] : nil
      @git_workflow =
        if source && File.file?(source)
          GitWorkflow.new(source, inventory_dir: @inventory_dir, mxcli: @mxcli)
        end
    rescue GitWorkflowError, JSON::ParserError => error
      @git_workflow_error = error.message
      @git_workflow = nil
    end

    def git_workflow_error
      @git_workflow_error || "Git workflow is unavailable for this project."
    end

    def run_mxcli(*arguments)
      stdout, stderr, status = Open3.capture3(@mxcli, *arguments)
      return stdout if status.success?

      message = stderr.lines.reject { |line| line.start_with?("WARNING:") }.join.strip
      raise BackendServerError, message
    end

    def normalize_marketplace(data)
      items = data.is_a?(Array) ? data : data.fetch("items", data.fetch("results", []))
      items.map { |item| normalize_marketplace_item(item) }
    end

    def normalize_marketplace_item(item)
      {
        id: pick(item, "id", "contentId", "content_id").to_s,
        name: pick(item, "name", "title"),
        publisher: pick(item, "publisher", "provider"),
        latestVersion: pick(item, "latestVersion", "latest_version", "version"),
        category: pick(item, "category", "type"),
        rating: pick(item, "rating"),
        downloads: pick(item, "downloads", "downloadCount", "download_count"),
        summary: pick(item, "summary", "description"),
        url: pick(item, "url", "marketplaceUrl", "marketplace_url")
      }.compact
    end

    def pick(item, *keys)
      keys.each { |key| return item[key] if item.key?(key) }
      nil
    end

    def valid_position?(position)
      position.is_a?(Hash) &&
        position["id"].is_a?(String) &&
        position["label"].is_a?(String) &&
        position["x"].is_a?(Numeric) &&
        position["y"].is_a?(Numeric)
    end

    def persist_visual_plan(qn, payload, result)
      path = File.join(@inventory_dir, "inventory", "visual-plans.json")
      @layout_mutex.synchronize do
        plans = File.file?(path) ? JSON.parse(File.read(path)) : {}
        plans[qn] = {
          "saved_at" => Time.now.iso8601,
          "request" => payload,
          "result" => result
        }
        temporary = "#{path}.tmp"
        File.write(temporary, "#{JSON.pretty_generate(plans)}\n")
        File.rename(temporary, path)
      end
    end

    # Accepts a visually-built page body, wraps it in CREATE OR MODIFY PAGE using
    # the page's imported settings, validates the MDL with `mxcli check`, and saves
    # a reviewable draft. It never writes the .mpr — applying stays in the guarded
    # workflow (mxcli exec / bin/mendix-apply).
    def page_route(request, response)
      return json(response, { error: "method not allowed" }, status: 405) unless
        request.request_method == "POST"

      payload = JSON.parse(request.body.to_s)
      qn = payload.fetch("qn")
      content = payload.fetch("content").to_s
      detail = page_detail(qn)
      return json(response, { error: "unknown page" }, status: 404) unless detail

      mdl = build_page_mdl(qn, detail, content)
      ok, message = check_mdl(mdl)
      message = friendly_check_message(message) unless ok
      persist_page_draft(qn, content, mdl, ok, message)
      json(
        response,
        { ok:, mdl:, message: ok ? "Page MDL validated and draft saved." : "Draft saved (not applied): #{message}" }
      )
    rescue KeyError => error
      json(response, { error: "missing parameter: #{error.key}" }, status: 400)
    rescue JSON::ParserError
      json(response, { error: "invalid JSON payload" }, status: 400)
    end

    # Accepts a rebuilt microflow/nanoflow body from the flow editor, wraps it in
    # CREATE OR MODIFY MICROFLOW/NANOFLOW using the imported signature, validates
    # with `mxcli check`, and saves a reviewable draft — same contract as pages.
    def flow_route(request, response)
      return json(response, { error: "method not allowed" }, status: 405) unless
        request.request_method == "POST"

      payload = JSON.parse(request.body.to_s)
      qn = payload.fetch("qn")
      body = payload.fetch("body").to_s
      detail = page_detail(qn)
      return json(response, { error: "unknown flow" }, status: 404) unless detail

      mdl = build_flow_mdl(qn, detail, body)
      ok, message = check_mdl(mdl)
      message = friendly_check_message(message) unless ok
      persist_draft("flow-plans.json", qn, "body" => body, "mdl" => mdl, "valid" => ok, "message" => message)
      json(
        response,
        { ok:, mdl:, message: ok ? "Flow MDL validated and draft saved." : "Draft saved (not applied): #{message}" }
      )
    rescue KeyError => error
      json(response, { error: "missing parameter: #{error.key}" }, status: 400)
    rescue JSON::ParserError
      json(response, { error: "invalid JSON payload" }, status: 400)
    end

    def build_flow_mdl(qn, detail, body)
      keyword = detail["mdl"].to_s.match?(/\bnanoflow\b/i) ? "NANOFLOW" : "MICROFLOW"
      params = Array(detail["parameters"]).map do |parameter|
        "$#{parameter['name']}: #{parameter['type']}"
      end
      header = +"CREATE OR MODIFY #{keyword} #{qn} (#{params.join(', ')})"
      header << "\nRETURNS #{detail['return_type']}" if detail["return_type"]
      header << "\nFOLDER '#{escape_mdl(detail['folder'])}'" if detail["folder"]
      indented = body.strip.empty? ? "" : body.lines.map { |line| line.rstrip }.join("\n")
      "#{header}\nBEGIN\n#{indented}\nEND;\n"
    end

    # Lists the reviewable drafts saved by the visual builders so the viewer can
    # surface them (they only exist as inventory sidecars otherwise).
    def drafts(response)
      read = lambda do |file|
        path = File.join(@inventory_dir, "inventory", file)
        File.file?(path) ? JSON.parse(File.read(path)) : {}
      end
      json(
        response,
        {
          entities: read.call("visual-plans.json"),
          pages: read.call("page-plans.json"),
          flows: read.call("flow-plans.json")
        }
      )
    end

    # Guarded marketplace install, Studio Pro-like: downloads the module and
    # imports it into the source project via mxcli, then refreshes the inventory
    # so the new module shows up in the explorer. Requires confirming Studio Pro
    # is closed (the .mpr is locked while it runs).
    def marketplace_install(request, response)
      return json(response, { error: "method not allowed" }, status: 405) unless
        request.request_method == "POST"

      payload = JSON.parse(request.body.to_s)
      id = payload.fetch("id").to_s
      return json(response, { error: "invalid marketplace id" }, status: 422) unless
        id.match?(/\A\d+\z/)
      unless payload["studio_closed"] == true
        return json(
          response,
          { ok: false, message: "Confirm Studio Pro is closed before installing." },
          status: 403
        )
      end

      project = source_project
      return json(response, { error: "source project unavailable" }, status: 503) unless project

      arguments = ["marketplace", "install", id]
      arguments.concat(["--version", payload["version"].to_s]) if payload["version"]
      arguments.concat(["-p", project])
      output = run_mxcli(*arguments)
      refresh_error = refresh_inventory(project)

      json(
        response,
        {
          ok: true,
          message: refresh_error || "Module installed and inventory refreshed.",
          output: output.lines.last(6).join.strip
        }
      )
    rescue KeyError => error
      json(response, { error: "missing parameter: #{error.key}" }, status: 400)
    rescue JSON::ParserError
      json(response, { error: "invalid JSON payload" }, status: 400)
    rescue BackendServerError => error
      json(response, { ok: false, message: error.message }, status: 502)
    end

    # Applies a validated page or flow draft to the source .mpr via mxcli exec,
    # then removes the draft entry and refreshes the inventory.
    def apply_draft_route(request, response)
      return json(response, { error: "method not allowed" }, status: 405) unless
        request.request_method == "POST"

      payload = JSON.parse(request.body.to_s)
      qn = payload.fetch("qn")
      type = payload.fetch("type")
      unless payload["studio_closed"] == true
        return json(
          response,
          { ok: false, message: "Confirm Studio Pro is closed before applying." },
          status: 403
        )
      end

      project = source_project
      return json(response, { error: "source project unavailable" }, status: 503) unless project

      file = type == "flow" ? "flow-plans.json" : "page-plans.json"
      draft = read_draft(file, qn)
      return json(response, { error: "draft not found for #{qn}" }, status: 404) unless draft
      unless draft["valid"]
        return json(
          response,
          { ok: false, message: "Draft is not valid; save a valid version first." },
          status: 422
        )
      end

      mdl = draft["mdl"].to_s
      if mdl.strip.empty?
        return json(response, { ok: false, message: "Draft MDL is empty." }, status: 422)
      end

      Tempfile.create(["mendix-apply-draft-", ".mdl"]) do |file_handle|
        file_handle.write(mdl)
        file_handle.flush
        stdout, stderr, status = Open3.capture3(
          @mxcli, "exec", file_handle.path, "-p", project
        )
        unless status.success?
          detail = (stderr.empty? ? stdout : stderr).strip
          return json(response, { ok: false, message: "Apply failed: #{detail}" }, status: 422)
        end
      end

      delete_draft(file, qn)
      refresh_error = refresh_inventory(project)
      json(
        response,
        { ok: true, message: refresh_error || "Draft applied and inventory refreshed." }
      )
    rescue KeyError => error
      json(response, { error: "missing parameter: #{error.key}" }, status: 400)
    rescue JSON::ParserError
      json(response, { error: "invalid JSON payload" }, status: 400)
    end

    def source_project
      metadata_path = File.join(@inventory_dir, "mendix-project.json")
      return nil unless File.file?(metadata_path)

      source = JSON.parse(File.read(metadata_path))["source_project"]
      source if source && File.file?(source)
    rescue JSON::ParserError
      nil
    end

    def refresh_inventory(project)
      Importer.new(mxcli: @mxcli).import(project, @inventory_dir)
      nil
    rescue StandardError => error
      "Module installed, but the inventory refresh failed: #{error.message}"
    end

    def read_draft(file, qn)
      path = File.join(@inventory_dir, "inventory", file)
      return nil unless File.file?(path)

      JSON.parse(File.read(path))[qn]
    rescue JSON::ParserError
      nil
    end

    def delete_draft(file, qn)
      path = File.join(@inventory_dir, "inventory", file)
      @layout_mutex.synchronize do
        return unless File.file?(path)

        plans = JSON.parse(File.read(path))
        plans.delete(qn)
        temporary = "#{path}.tmp"
        File.write(temporary, "#{JSON.pretty_generate(plans)}\n")
        File.rename(temporary, path)
      end
    end

    def page_detail(qn)
      path = File.join(@inventory_dir, "inventory", "element-details.json")
      return nil unless File.file?(path)

      detail = JSON.parse(File.read(path))[qn]
      detail if detail.is_a?(Hash) && detail.key?("mdl")
    end

    def build_page_mdl(qn, detail, content)
      settings = ["Title: '#{escape_mdl(detail['title'] || qn.split('.').last)}'"]
      settings << "Layout: #{detail['layout']}" if detail["layout"]
      settings << "Folder: '#{escape_mdl(detail['folder'])}'" if detail["folder"]
      params = Array(detail["parameters"]).map do |parameter|
        "$#{parameter['name']}: #{parameter['type']}"
      end
      settings << "Params: { #{params.join(', ')} }" unless params.empty?

      body = content.strip.empty? ? "" : content.lines.map { |line| "  #{line.rstrip}" }.join("\n")
      "CREATE OR MODIFY PAGE #{qn} (\n  #{settings.join(",\n  ")}\n) {\n#{body}\n}\n"
    end

    def check_mdl(mdl)
      Tempfile.create(["mendix-page-", ".mdl"]) do |file|
        file.write(mdl)
        file.flush
        stdout, stderr, status = Open3.capture3(@mxcli, "check", file.path)
        return [true, nil] if status.success?

        output = (stderr.empty? ? stdout : stderr).lines
          .reject { |line| line.start_with?("WARNING:") }.join.strip
        [false, output]
      end
    end

    # Condenses a raw mxcli syntax-error dump into a one-liner. Detects the
    # common case where an unrecognised token is a marketplace widget name so
    # the user gets a actionable hint instead of a wall of grammar errors.
    def friendly_check_message(message)
      return message if message.nil? || message.empty?

      # Extract the first unknown token from "mismatched input 'X' expecting"
      if (m = message.match(/mismatched input '([^']+)'/))
        token = m[1]
        # Marketplace widgets often have digits (datagrid2, gallery1, etc.)
        if token.match?(/[a-z]\w*\d/i) || !%w[
          container dataview textbox textarea button label image
          listview layoutgrid row column header footer snippet
          tabcontainer tabpage groupbox scrollcontainer
          actionbutton navigationbutton dynamictext statictext
        ].include?(token.downcase)
          return "Contains marketplace widget '#{token}' — MDL grammar does not support it. " \
            "Draft saved; apply via CLI (mxcli exec) after manual review."
        end
      end

      # Return only the first error line to avoid the wall of text
      first = message.lines.first&.strip
      first&.start_with?("Syntax") ? first : message.lines.first(3).join(" ").gsub(/\s+/, " ").strip
    end

    def persist_page_draft(qn, content, mdl, ok, message)
      persist_draft(
        "page-plans.json", qn,
        "content" => content, "mdl" => mdl, "valid" => ok, "message" => message
      )
    end

    # Atomic upsert into a draft sidecar under inventory/ (temp + rename, mutex).
    def persist_draft(file, qn, entry)
      path = File.join(@inventory_dir, "inventory", file)
      @layout_mutex.synchronize do
        plans = File.file?(path) ? JSON.parse(File.read(path)) : {}
        plans[qn] = { "saved_at" => Time.now.iso8601 }.merge(entry.compact)
        temporary = "#{path}.tmp"
        File.write(temporary, "#{JSON.pretty_generate(plans)}\n")
        File.rename(temporary, path)
      end
    end

    def escape_mdl(value)
      value.to_s.gsub("'", "''")
    end

    def json(response, payload, status: 200)
      response.status = status
      response["content-type"] = "application/json; charset=utf-8"
      response["cache-control"] = "no-store"
      response.body = "#{JSON.generate(payload)}\n"
    end
  end
end
