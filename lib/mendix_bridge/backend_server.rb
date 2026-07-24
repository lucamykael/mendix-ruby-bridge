# frozen_string_literal: true

require "json"
require "open3"
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
      @server.mount_proc("/api/marketplace/search") do |request, response|
        marketplace_search(request, response)
      end
      @server.mount_proc("/api/marketplace/item") do |request, response|
        marketplace_item(request, response)
      end
      @server.mount_proc("/api/marketplace/install") do |_request, response|
        json(
          response,
          {
            ok: false,
            message:
              "Marketplace installation is disabled in the viewer. " \
              "Use mxcli with the guarded Git workflow."
          },
          status: 403
        )
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
            marketplace_install: false
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

    def json(response, payload, status: 200)
      response.status = status
      response["content-type"] = "application/json; charset=utf-8"
      response["cache-control"] = "no-store"
      response.body = "#{JSON.generate(payload)}\n"
    end
  end
end
