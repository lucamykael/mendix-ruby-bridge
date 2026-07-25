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
      logger: nil,
      run_cmd: nil
    )
      @inventory_dir = File.expand_path(inventory_dir)
      @web_root = File.expand_path(web_root)
      @mxcli = File.expand_path(mxcli)
      @layout_mutex = Mutex.new
      @app_mutex = Mutex.new
      @app_log = []
      @app_pid = nil
      @app_type = nil       # :docker | :direct
      @docker_running = false
      @auth_user = nil
      @run_cmd_override = run_cmd
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
      @server.mount_proc("/api/create") { |request, response| create_element_route(request, response) }
      @server.mount_proc("/api/query") { |request, response| query_route(request, response) }
      @server.mount_proc("/api/errors") { |_request, response| errors_route(response) }
      @server.mount_proc("/api/mdl") { |request, response| mdl_route(request, response) }
      @server.mount_proc("/api/app") { |request, response| app_route(request, response) }
      @server.mount_proc("/api/auth") { |request, response| auth_route(request, response) }
      @server.mount_proc("/api/settings") { |request, response| settings_route(request, response) }
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
            apply_drafts: source_project ? true : false,
            app_run: (source_project && !resolve_run_cmd(source_project).nil?) ? true : false
          },
          app: {
            running: @app_mutex.synchronize { !@app_pid.nil? || @docker_running },
            log_length: @app_mutex.synchronize { @app_log.length },
            mode: @app_mutex.synchronize { @app_type }
          },
          auth: {
            logged_in: !@auth_user.nil?,
            username: @auth_user
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
      refresh = %w[1 true yes].include?(request.query["refresh"].to_s)

      # Live search against the official Mendix marketplace via mxcli. The
      # marketplace is entirely behind Mendix SSO, so this only works with a
      # logged-in credential; --refresh bypasses mxcli's local catalog cache.
      args = ["marketplace", "search", query, "--limit", limit.to_s, "--json"]
      args << "--refresh" if refresh
      output = run_mxcli(*args)
      data = JSON.parse(output)
      json(response, { items: normalize_marketplace(data), source: "live" })
    rescue BackendServerError => error
      # Not logged in (or mxcli failed): serve the bundled offline catalog so
      # browsing still works. Flag it so the UI can invite the user to log in
      # for the full live marketplace.
      items = catalog_search(query, limit)
      needs_login = auth_error?(error.message)
      if items
        return json(response, {
          items: items, source: "offline", needs_login: needs_login,
          message: needs_login ? "Log in to Mendix for live marketplace search." : nil
        })
      end

      json(response, { error: error.message }, status: 502)
    rescue JSON::ParserError
      json(response, { error: "mxcli returned invalid marketplace JSON" }, status: 502)
    end

    # True when an mxcli error is about a missing/expired credential.
    def auth_error?(message)
      message.to_s.match?(/no credential|auth login|not authenticated|unauthorized/i)
    end

    # Path of the offline marketplace catalog: refreshed copy in the inventory
    # dir wins over the seed bundled with the gem. Override with
    # MRB_MARKETPLACE_CATALOG.
    def marketplace_catalog_path
      [
        ENV["MRB_MARKETPLACE_CATALOG"],
        File.join(@inventory_dir, "marketplace_catalog.json"),
        File.expand_path("../../data/marketplace_catalog.json", __dir__)
      ].compact.find { |path| File.file?(path) }
    end

    def marketplace_catalog
      path = marketplace_catalog_path
      return nil unless path

      data = JSON.parse(File.read(path))
      data.is_a?(Array) ? data : data.fetch("items", [])
    rescue JSON::ParserError
      nil
    end

    def catalog_search(query, limit)
      items = marketplace_catalog
      return nil unless items

      q = query.strip.downcase
      hits = items.select do |item|
        q.empty? || %w[name summary category publisher].any? { |k| item[k].to_s.downcase.include?(q) }
      end
      hits.first(limit).map { |item| normalize_marketplace_item(item) }
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
        id.match?(/\A[\w.-]+\z/)

      # Offline catalog entries (non-numeric ids) resolve locally.
      unless id.match?(/\A\d+\z/)
        hit = (marketplace_catalog || []).find { |item| item["id"].to_s == id }
        return json(response, normalize_marketplace_item(hit)) if hit

        return json(response, { error: "unknown catalog id" }, status: 404)
      end

      output = run_mxcli("marketplace", "info", id, "--json")
      json(response, normalize_marketplace_item(JSON.parse(output)))
    rescue BackendServerError => error
      hit = (marketplace_catalog || []).find { |item| item["id"].to_s == id }
      return json(response, normalize_marketplace_item(hit)) if hit

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
      detail = page_detail(qn)
      return json(response, { error: "unknown page" }, status: 404) unless detail

      # Two modes: "alter" sends a raw ALTER PAGE statement (in-place edits,
      # preserving everything else on the page); default regenerates the whole
      # page from the edited widget tree (CREATE OR MODIFY).
      if payload["mode"] == "alter"
        mdl = payload.fetch("mdl").to_s
        content = payload["content"].to_s
      else
        content = payload.fetch("content").to_s
        mdl = build_page_mdl(qn, detail, content)
      end
      ok, message = check_mdl(mdl)
      persist_page_draft(qn, content, mdl, ok, message)
      json(
        response,
        { ok:, mdl:, message: ok ? "Page MDL validated and draft saved." : message },
        status: ok ? 200 : 422
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
      persist_draft("flow-plans.json", qn, "body" => body, "mdl" => mdl, "valid" => ok, "message" => message)
      json(
        response,
        { ok:, mdl:, message: ok ? "Flow MDL validated and draft saved." : message },
        status: ok ? 200 : 422
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
      if id.start_with?("seed-")
        return json(
          response,
          { ok: false, message: "Offline catalog entry — installing requires a Mendix login (mxcli auth login), which also refreshes the catalog with real ids." },
          status: 403
        )
      end
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
      if auth_error?(error.message)
        return json(
          response,
          { ok: false, needs_login: true,
            message: "Log in to Mendix first (👤 button) to install marketplace modules." },
          status: 401
        )
      end
      # Trim the mxcli usage/help dump to the first meaningful error line.
      brief = error.message.to_s.lines.map(&:strip)
        .find { |l| !l.empty? && !l.start_with?("WARNING:", "Usage:", "hint:") } || error.message
      json(response, { ok: false, message: "Install failed: #{brief}" }, status: 502)
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
      # The inventory refresh describes every element and can take a while —
      # run it in the background so the Apply button returns right away.
      refresh_inventory_async(project)
      json(
        response,
        { ok: true, message: "Draft applied — inventory refresh running in background." }
      )
    rescue KeyError => error
      json(response, { error: "missing parameter: #{error.key}" }, status: 400)
    rescue JSON::ParserError
      json(response, { error: "invalid JSON payload" }, status: 400)
    end

    # Create a new element (module, page, microflow, nanoflow, entity,
    # enumeration) in the source .mpr via mxcli exec, Studio Pro-style. An
    # optional folder path places the document (folders are created by MOVE).
    IDENTIFIER = /\A[A-Za-z][A-Za-z0-9_]*\z/
    FOLDER_PATH = %r{\A[A-Za-z0-9_ -]+(/[A-Za-z0-9_ -]+)*\z}

    CREATE_KINDS = {
      "module"      => nil,
      "page"        => "PAGE",
      "microflow"   => "MICROFLOW",
      "nanoflow"    => "NANOFLOW",
      "entity"      => "ENTITY",
      "enumeration" => "ENUMERATION"
    }.freeze

    def create_element_route(request, response)
      return json(response, { error: "method not allowed" }, status: 405) unless
        request.request_method == "POST"

      payload = JSON.parse(request.body.to_s)
      kind = payload.fetch("kind").to_s
      name = payload.fetch("name").to_s
      mod = payload["module"].to_s
      folder = payload["folder"].to_s.strip

      return json(response, { error: "unknown kind: #{kind}" }, status: 422) unless
        CREATE_KINDS.key?(kind)
      return json(response, { error: "invalid name" }, status: 422) unless name.match?(IDENTIFIER)
      if kind != "module"
        return json(response, { error: "invalid module" }, status: 422) unless mod.match?(IDENTIFIER)
      end
      if !folder.empty? && !folder.match?(FOLDER_PATH)
        return json(response, { error: "invalid folder path" }, status: 422)
      end
      unless payload["studio_closed"] == true
        return json(
          response,
          { ok: false, message: "Confirm Studio Pro is closed before creating elements." },
          status: 403
        )
      end

      project = source_project
      return json(response, { error: "source project unavailable" }, status: 503) unless project

      mdl =
        case kind
        when "module"      then "CREATE MODULE #{name};"
        when "page"        then "CREATE PAGE #{mod}.#{name} (Title: '#{name}', Layout: Atlas_Core.Atlas_Default) {}"
        when "microflow"   then "CREATE MICROFLOW #{mod}.#{name} ()\nBEGIN\n  return;\nEND;"
        when "nanoflow"    then "CREATE NANOFLOW #{mod}.#{name} ()\nBEGIN\n  return;\nEND;"
        when "entity"      then "CREATE ENTITY #{mod}.#{name};"
        when "enumeration" then "CREATE ENUMERATION #{mod}.#{name} VALUES ('Default');"
        end
      if kind != "module" && !folder.empty?
        mdl += "\nMOVE #{CREATE_KINDS[kind]} #{mod}.#{name} TO FOLDER '#{folder}';"
      end

      Tempfile.create(["mendix-create-", ".mdl"]) do |file_handle|
        file_handle.write("#{mdl}\n")
        file_handle.flush
        stdout, stderr, status = Open3.capture3(@mxcli, "exec", file_handle.path, "-p", project)
        unless status.success?
          detail = (stderr.empty? ? stdout : stderr).strip
          return json(response, { ok: false, message: "Create failed: #{detail}" }, status: 422)
        end
      end

      refresh_inventory_async(project)
      qn = kind == "module" ? name : "#{mod}.#{name}"
      json(response, { ok: true, qn: qn, message: "#{kind.capitalize} #{qn} created — inventory refreshing." })
    rescue KeyError => error
      json(response, { error: "missing parameter: #{error.key}" }, status: 400)
    rescue JSON::ParserError
      json(response, { error: "invalid JSON payload" }, status: 400)
    end

    # Read-only data queries against the project. OQL runs against the running
    # Mendix app via the M2EE admin API (rollback/preview mode); SQL runs
    # against the configured database. Neither needs a marketplace login — OQL
    # is a built-in Mendix query language, not an installable module.
    def query_route(request, response)
      return json(response, { error: "method not allowed" }, status: 405) unless
        request.request_method == "POST"

      payload = JSON.parse(request.body.to_s)
      engine = payload.fetch("engine").to_s
      query = payload.fetch("query").to_s.strip
      return json(response, { ok: false, message: "Query is empty." }, status: 422) if query.empty?
      unless %w[oql sql].include?(engine)
        return json(response, { error: "unknown engine: #{engine}" }, status: 422)
      end

      project = source_project
      return json(response, { error: "source project unavailable" }, status: 503) unless project

      args =
        if engine == "oql"
          [@mxcli, "oql", "-p", project, "--json", query]
        else
          dsn = sql_dsn
          unless dsn
            return json(
              response,
              { ok: false, message: "No database connection configured. Set it in Settings (DB host/port/name/user/password)." },
              status: 422
            )
          end
          [@mxcli, "sql", "-p", project, "--json", "--dsn", dsn, query]
        end

      stdout, stderr, status = Open3.capture3(*args)
      unless status.success?
        detail = clean_mxcli_error(stderr.empty? ? stdout : stderr)
        hint = engine == "oql" ? " (is the app running? OQL needs the app up)" : ""
        return json(response, { ok: false, message: "Query failed: #{detail}#{hint}" }, status: 422)
      end

      rows = parse_query_rows(stdout)
      json(response, { ok: true, engine: engine, rows: rows, count: rows.length })
    rescue KeyError => error
      json(response, { error: "missing parameter: #{error.key}" }, status: 400)
    rescue JSON::ParserError
      json(response, { error: "invalid JSON payload" }, status: 400)
    end

    # Build a Postgres DSN from the project's .docker/.env. External DB mode
    # points at the configured host; local Docker mode reaches the container's
    # published port on localhost.
    def sql_dsn
      path = docker_env_path
      return nil unless path

      env = parse_env_file(path)
      name = env["DB_NAME"].to_s
      user = env["DB_USER"].to_s
      pass = env["DB_PASSWORD"].to_s
      return nil if name.empty? || user.empty?

      if env["DB_MODE"].to_s == "external"
        host = env["EXT_DB_HOST"].to_s
        port = env.fetch("EXT_DB_PORT", "5432")
        return nil if host.empty?
      else
        host = "localhost"
        port = env.fetch("DB_PORT", "5432")
      end

      require "cgi"
      "postgres://#{CGI.escape(user)}:#{CGI.escape(pass)}@#{host}:#{port}/#{name}?sslmode=disable"
    end

    def parse_query_rows(stdout)
      out = stdout.to_s.strip
      return [] if out.empty?

      data = JSON.parse(out)
      data.is_a?(Array) ? data : [data]
    rescue JSON::ParserError
      # Fall back to raw text so the user still sees the tool's output.
      [{ "output" => stdout.to_s.strip }]
    end

    def clean_mxcli_error(text)
      text.to_s.lines.reject { |l| l.start_with?("WARNING:") }.join.strip
    end

    # Project consistency check via `mxcli lint`. Powers the Errors tab —
    # naming, empty microflows, missing access rules, security rules, etc.
    def errors_route(response)
      project = source_project
      return json(response, { error: "source project unavailable" }, status: 503) unless project

      # A non-zero exit just means violations were found, so ignore the status.
      stdout, stderr, = Open3.capture3(@mxcli, "lint", "-p", project, "-f", "json")
      # lint prints a catalog-building progress preamble before the JSON body;
      # slice from the first brace.
      brace = stdout.index("{")
      unless brace
        detail = clean_mxcli_error(stderr.empty? ? stdout : stderr)
        return json(response, { ok: false, message: "Lint failed: #{detail}" }, status: 502)
      end

      data = JSON.parse(stdout[brace..])
      violations = (data["violations"] || []).map do |v|
        {
          ruleId: v["ruleId"],
          severity: v["severity"] || "warning",
          message: v["message"],
          module: v["module"],
          document: v["document"],
          documentType: v["documentType"],
          qn: [v["module"], v["document"]].compact.join("."),
          suggestion: v["suggestion"]
        }
      end
      json(response, { ok: true, violations: violations, count: violations.length })
    rescue JSON::ParserError
      json(response, { ok: false, message: "mxcli lint returned invalid JSON." }, status: 502)
    end

    # General-purpose MDL execution primitive. Powers live editing from the AI
    # chat (agents emit MDL; the user validates/applies it) and any other
    # feature that needs to run arbitrary MDL. `apply: false` only validates
    # (mxcli check); `apply: true` runs `mxcli exec` and requires Studio Pro
    # closed, then refreshes the inventory in the background.
    def mdl_route(request, response)
      return json(response, { error: "method not allowed" }, status: 405) unless
        request.request_method == "POST"

      payload = JSON.parse(request.body.to_s)
      mdl = payload.fetch("mdl").to_s
      return json(response, { ok: false, message: "MDL is empty." }, status: 422) if mdl.strip.empty?

      apply = payload["apply"] == true
      project = source_project
      return json(response, { error: "source project unavailable" }, status: 503) unless project

      ok, message = check_mdl(mdl)
      return json(response, { ok: false, applied: false, message: message }, status: 422) unless ok

      unless apply
        return json(response, { ok: true, applied: false, message: "MDL is valid." })
      end
      unless payload["studio_closed"] == true
        return json(
          response,
          { ok: false, applied: false, needs_studio_closed: true,
            message: "Confirm Studio Pro is closed to apply changes to the project." },
          status: 403
        )
      end

      Tempfile.create(["mendix-mdl-", ".mdl"]) do |file_handle|
        file_handle.write(mdl)
        file_handle.flush
        stdout, stderr, status = Open3.capture3(@mxcli, "exec", file_handle.path, "-p", project)
        unless status.success?
          detail = clean_mxcli_error(stderr.empty? ? stdout : stderr)
          return json(response, { ok: false, applied: false, message: "Apply failed: #{detail}" }, status: 422)
        end
      end

      refresh_inventory_async(project)
      json(response, { ok: true, applied: true, message: "MDL applied — inventory refreshing in background." })
    rescue KeyError => error
      json(response, { error: "missing parameter: #{error.key}" }, status: 400)
    rescue JSON::ParserError
      json(response, { error: "invalid JSON payload" }, status: 400)
    end

    # ---- app run/stop/log ------------------------------------------------

    def app_route(request, response)
      action = request.path.delete_prefix("/api/app").sub(%r{\A/}, "")
      case [request.request_method, action]
      when ["POST", "run"]  then app_run(response)
      when ["POST", "stop"] then app_stop(response)
      when ["GET",  "status"] then app_status(response)
      when ["GET",  "log"]  then app_log_response(request, response)
      else json(response, { error: "not found" }, status: 404)
      end
    end

    def app_run(response)
      already = @app_mutex.synchronize { !@app_pid.nil? || @docker_running }
      return json(response, { ok: false, message: "Already running.", running: true }, status: 409) if already

      project = source_project
      return json(response, { ok: false, message: "No source project configured.", running: false }, status: 503) unless project

      mode, cmd = resolve_run_mode(project)
      unless cmd
        return json(
          response,
          {
            ok: false, running: false,
            message: "No run command found. Add a local mxcli to the project directory, " \
                     "create a .mendix-run-cmd file, or set MRB_RUN_CMD env var."
          },
          status: 503
        )
      end

      @app_mutex.synchronize do
        # Append (don't reset): log consumers poll by offset, and a reset
        # would strand them past the end of the new, shorter log.
        @app_log << "" unless @app_log.empty?
        @app_log << "$ #{cmd.join(' ')}" << "Starting…"
        @app_type = mode
        @docker_running = false
      end

      Thread.new do
        success = false
        begin
          Open3.popen2e(*cmd) do |stdin, stdouterr, wait_thr|
            stdin.close
            @app_mutex.synchronize { @app_pid = wait_thr.pid }
            stdouterr.each_line do |line|
              @app_mutex.synchronize do
                @app_log << line.chomp
                @app_log = @app_log.last(2000)
              end
            end
            success = wait_thr.value.success?
          end
        rescue Errno::ENOENT => error
          @app_mutex.synchronize { @app_log << "[ERROR] Command not found: #{error.message}" }
        rescue StandardError => error
          @app_mutex.synchronize { @app_log << "[ERROR] #{error.message}" }
        ensure
          @app_mutex.synchronize do
            @app_pid = nil
            if mode == :docker && success
              # Containers are running independently; keep @docker_running true
              @docker_running = true
              @app_log << "[App running in Docker containers]"
            else
              @docker_running = false
              @app_log << "[Stopped]" unless success && mode == :docker
            end
          end
        end
      end

      json(response, { ok: true, message: "Starting Mendix application…", running: true })
    end

    def app_stop(response)
      project = source_project
      type, docker = @app_mutex.synchronize { [@app_type, @docker_running] }
      pid = @app_mutex.synchronize { @app_pid }

      if type == :docker && (docker || pid)
        stop_cmd = docker_stop_cmd(project)
        if stop_cmd
          Thread.new do
            @app_mutex.synchronize { @app_log << "$ #{stop_cmd.join(' ')}" }
            Open3.popen2e(*stop_cmd) do |stdin, stdouterr, wait_thr|
              stdin.close
              stdouterr.each_line { |l| @app_mutex.synchronize { @app_log << l.chomp } }
              wait_thr.value
            end
            @app_mutex.synchronize do
              @docker_running = false
              @app_pid = nil
              @app_log << "[Containers stopped]"
            end
          rescue StandardError => e
            @app_mutex.synchronize { @docker_running = false; @app_log << "[ERROR] #{e.message}" }
          end
          return json(response, { ok: true, message: "Stopping Docker containers…" })
        end
      end

      if pid
        begin
          Process.kill("TERM", pid)
        rescue Errno::ESRCH
          @app_mutex.synchronize { @app_pid = nil }
        end
        return json(response, { ok: true, message: "Stop signal sent." })
      end

      json(response, { ok: false, message: "No application is running." })
    end

    def app_status(response)
      pid, docker, len = @app_mutex.synchronize { [@app_pid, @docker_running, @app_log.length] }
      json(response, { running: !pid.nil? || docker, log_length: len })
    end

    def app_log_response(request, response)
      offset = request.query["offset"].to_i.clamp(0, Float::INFINITY)
      pid, docker, log = @app_mutex.synchronize { [@app_pid, @docker_running, @app_log.dup] }
      lines = log.drop(offset)
      json(
        response,
        { lines: lines, offset: offset + lines.length, total: log.length, running: !pid.nil? || docker }
      )
    end

    # Returns [mode, cmd_array] where mode is :docker, :direct, or nil
    def resolve_run_mode(project)
      # 1. Explicit override → direct
      if (raw = @run_cmd_override || ENV["MRB_RUN_CMD"]) && !raw.strip.empty?
        require "shellwords"
        return [:direct, Shellwords.split(raw) + [project]]
      end

      project_dir = File.dirname(File.expand_path(project))

      # 2. .mendix-run-cmd file in project directory → direct
      run_file = File.join(project_dir, ".mendix-run-cmd")
      if File.file?(run_file)
        raw = File.read(run_file).lines
          .reject { |l| l.strip.start_with?("#") || l.strip.empty? }.first&.strip
        if raw
          require "shellwords"
          return [:direct, Shellwords.split(raw) + [project]]
        end
      end

      # 3. Local mxcli in project directory → docker mode
      local_mxcli = File.join(project_dir, "mxcli")
      if File.executable?(local_mxcli)
        return [:docker, [local_mxcli, "docker", "run", "-p", project]]
      end

      # 4. mx in PATH (Mendix runtime CLI, not MxBuild)
      mx = which_binary("mx")
      return [:direct, [mx, "run", project]] if mx

      [nil, nil]
    rescue ArgumentError
      [nil, nil]
    end

    def docker_stop_cmd(project)
      return nil unless project

      project_dir = File.dirname(File.expand_path(project))
      local_mxcli = File.join(project_dir, "mxcli")
      return nil unless File.executable?(local_mxcli)

      [local_mxcli, "docker", "down", "-p", project]
    end

    def resolve_run_cmd(project)
      _, cmd = resolve_run_mode(project)
      cmd
    end

    def which_binary(name)
      (ENV["PATH"] || "").split(File::PATH_SEPARATOR).each do |dir|
        candidate = File.join(dir, name)
        return candidate if File.executable?(candidate) && !File.directory?(candidate)
      end
      nil
    end

    # ---- auth (Mendix marketplace login) ---------------------------------

    def auth_route(request, response)
      action = request.path.delete_prefix("/api/auth").sub(%r{\A/}, "")
      case [request.request_method, action]
      when ["GET",  "status"] then auth_status(response)
      when ["POST", "login"]  then auth_login(request, response)
      when ["POST", "logout"] then auth_logout(response)
      else json(response, { error: "not found" }, status: 404)
      end
    end

    def auth_status(response)
      # Always ask mxcli for the live credential status
      _, _, st = Open3.capture3(@mxcli, "auth", "status", "--offline")
      live = st.success?
      @auth_user = nil unless live
      json(response, { logged_in: live, username: @auth_user })
    rescue StandardError
      json(response, { logged_in: false, username: nil })
    end

    def auth_login(request, response)
      payload = JSON.parse(request.body.to_s)
      pat = payload.fetch("pat").to_s.strip
      return json(response, { ok: false, message: "Personal Access Token is required." }, status: 400) if pat.empty?

      stdout, stderr, status = Open3.capture3(@mxcli, "auth", "login", "--token", pat)
      if status.success?
        # Try to read username from status after login
        out2, _, _ = Open3.capture3(@mxcli, "auth", "status", "--json", "--offline")
        begin
          data = JSON.parse(out2)
          @auth_user = data["username"] || data["user"] || data["email"] || "authenticated"
        rescue JSON::ParserError
          @auth_user = "authenticated"
        end
        json(response, { ok: true, message: "PAT stored. Marketplace access enabled.", username: @auth_user })
      else
        msg = (stderr.empty? ? stdout : stderr).lines
          .reject { |l| l.strip.start_with?("WARNING:") }.join.strip
        json(response, { ok: false, message: msg.empty? ? "Login failed. Check your PAT." : msg }, status: 401)
      end
    rescue KeyError => error
      json(response, { error: "missing parameter: #{error.key}" }, status: 400)
    rescue JSON::ParserError
      json(response, { error: "invalid JSON payload" }, status: 400)
    end

    def auth_logout(response)
      _, _, st = Open3.capture3(@mxcli, "auth", "logout")
      @auth_user = nil
      if st.success?
        json(response, { ok: true, message: "PAT removed." })
      else
        json(response, { ok: true, message: "Logged out (no stored PAT)." })
      end
    rescue StandardError => error
      @auth_user = nil
      json(response, { ok: false, message: error.message })
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

    # Background inventory refresh with a single-flight guard: a second
    # request while one is running just marks it stale and re-runs once.
    def refresh_inventory_async(project)
      @refresh_mutex ||= Mutex.new
      again = @refresh_mutex.synchronize do
        if @refreshing
          @refresh_again = true
          true
        else
          @refreshing = true
          false
        end
      end
      return if again

      Thread.new do
        loop do
          refresh_inventory(project)
          done = @refresh_mutex.synchronize do
            if @refresh_again
              @refresh_again = false
              false
            else
              @refreshing = false
              true
            end
          end
          break if done
        end
      end
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

    # ---- project settings (docker env + db mode) -------------------------

    SETTINGS_KEYS = %w[
      APP_PORT ADMIN_PORT M2EE_ADMIN_PASS MX_LOG_LEVEL
      DB_MODE DB_PORT DB_NAME DB_USER DB_PASSWORD
      EXT_DB_HOST EXT_DB_PORT EXT_DB_SSL
    ].freeze

    def settings_route(request, response)
      env_path = docker_env_path
      case request.request_method
      when "GET"
        current = env_path ? parse_env_file(env_path) : {}
        json(
          response,
          {
            settings: current.slice(*SETTINGS_KEYS),
            env_path:,
            editable: !env_path.nil?
          }
        )
      when "PUT"
        return json(response, { error: "no .docker/.env found" }, status: 503) unless env_path
        payload = JSON.parse(request.body.to_s)
        updates = payload.slice(*SETTINGS_KEYS)
        update_env_file(env_path, updates)
        apply_db_mode(env_path, updates)
        json(response, { ok: true, message: "Settings saved. Restart the application for changes to take effect." })
      else
        json(response, { error: "method not allowed" }, status: 405)
      end
    rescue JSON::ParserError
      json(response, { error: "invalid JSON payload" }, status: 400)
    end

    def docker_env_path
      project = source_project
      return nil unless project

      path = File.join(File.dirname(File.expand_path(project)), ".docker", ".env")
      path if File.file?(path)
    end

    def parse_env_file(path)
      File.readlines(path, chomp: true).each_with_object({}) do |line, h|
        next if line.strip.start_with?("#") || !line.include?("=")
        key, _, value = line.partition("=")
        h[key.strip] = value
      end
    end

    def update_env_file(path, updates)
      lines = File.readlines(path)
      updates.each do |key, value|
        found = false
        lines.map! do |line|
          if line =~ /\A#{Regexp.escape(key)}=/
            found = true
            "#{key}=#{value}\n"
          else
            line
          end
        end
        lines << "#{key}=#{value}\n" unless found
      end
      File.write(path, lines.join)
    end

    # When DB_MODE=external, write a docker-compose.override.yml that:
    #   - Points the mendix service at the external DB host
    #   - Replaces the db service with a no-op container so depends_on succeeds instantly
    # When DB_MODE=local (or absent), remove any override file we created.
    def apply_db_mode(env_path, updates)
      mode = updates.fetch("DB_MODE", "local")
      docker_dir = File.dirname(env_path)
      override_path = File.join(docker_dir, "docker-compose.override.yml")

      if mode == "external"
        ext_host = updates.fetch("EXT_DB_HOST", "").strip
        ext_port = updates.fetch("EXT_DB_PORT", "5432").strip
        ssl = updates.fetch("EXT_DB_SSL", "false") == "true"

        db_type = ssl ? "POSTGRESQL_SSL" : "POSTGRESQL"
        db_host = "#{ext_host}:#{ext_port}"

        override_content = <<~YAML
          # Generated by Mendix Ruby Bridge — external database mode
          # Remove this file to revert to the local Docker PostgreSQL container
          services:
            mendix:
              environment:
                - RUNTIME_PARAMS_DATABASETYPE=#{db_type}
                - RUNTIME_PARAMS_DATABASEHOST=#{db_host}
            db:
              image: alpine
              command: ["echo", "External DB mode — local PostgreSQL container skipped"]
              healthcheck:
                test: ["CMD", "true"]
                interval: 1s
                timeout: 1s
                retries: 1
        YAML
        File.write(override_path, override_content)
      elsif File.file?(override_path)
        # Check that it's one we generated before removing
        content = File.read(override_path)
        File.delete(override_path) if content.include?("Generated by Mendix Ruby Bridge")
      end
    end

    def json(response, payload, status: 200)
      response.status = status
      response["content-type"] = "application/json; charset=utf-8"
      response["cache-control"] = "no-store"
      response.body = "#{JSON.generate(payload)}\n"
    end
  end
end
