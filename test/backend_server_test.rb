# frozen_string_literal: true

require "fileutils"
require "json"
require "minitest/autorun"
require "net/http"
require "socket"
require "tmpdir"
require_relative "../lib/mendix_bridge"

class BackendServerTest < Minitest::Test
  def setup
    @root = Dir.mktmpdir("mendix-backend")
    @inventory = File.join(@root, "project")
    @web = File.join(@root, "web")
    FileUtils.mkdir_p(File.join(@inventory, "inventory"))
    FileUtils.mkdir_p(@web)
    write_json(
      "inventory/project-tree.json",
      [
        {
          "label" => "Module",
          "type" => "module",
          "qualifiedName" => "Module",
          "children" => [
            {
              "label" => "Customer",
              "type" => "entity",
              "qualifiedName" => "Module.Customer"
            }
          ]
        }
      ]
    )
    write_json(
      "inventory/element-details.json",
      "Module.Flow" => { "kind" => "microflow", "mdl" => "BEGIN\nEND" },
      "Module.Customer" => {
        "parse_status" => "parsed",
        "persistable" => true,
        "attributes" => [],
        "access_rules" => []
      },
      "Module.Home" => {
        "parse_status" => "parsed",
        "title" => "Home",
        "layout" => "Atlas_Core.Default",
        "parameters" => [],
        "mdl" => "create or modify page Module.Home (Title: 'Home') {}"
      },
      "Module.ACT_Save" => {
        "parse_status" => "parsed",
        "parameters" => [{ "name" => "Customer", "type" => "Module.Customer" }],
        "return_type" => "Boolean",
        "folder" => "Actions",
        "mdl" => "create or modify microflow Module.ACT_Save ($Customer: Module.Customer) returns Boolean begin return true; end;"
      }
    )
    write_json("inventory/dependencies.json", "schema_version" => 1, "nodes" => 1, "edges" => [])
    @mpr = File.join(@root, "project.mpr")
    File.write(@mpr, "")
    write_json(
      "mendix-project.json",
      "element_count" => 1,
      "imported_at" => "2026-07-24T00:00:00Z",
      "source_project" => @mpr
    )
    File.write(File.join(@web, "index.html"), "<main>viewer</main>")
    @server = MendixBridge::BackendServer.new(
      inventory_dir: @inventory,
      web_root: @web,
      mxcli: "/usr/bin/true",
      port: 0
    )
    @thread = Thread.new { @server.start }
    wait_until_ready
  end

  def teardown
    @server&.shutdown
    @thread&.join(2)
    FileUtils.remove_entry(@root) if @root && File.exist?(@root)
  end

  def test_serves_health_inventory_and_frontend
    health = get_json("/api/health")
    assert health["ok"]
    assert_equal 1, health["element_count"]
    assert_equal true, health.dig("capabilities", "dependencies")

    assert_equal "Module", get_json("/inventory/project-tree.json").first["label"]
    assert_includes Net::HTTP.get(uri("/")), "viewer"
  end

  def test_persists_layout_for_known_element
    response = post_json(
      "/api/layout",
      qn: "Module.Flow",
      positions: [{ id: "start", label: "Start", x: 12.5, y: 20 }]
    )

    assert_equal "200", response.code
    assert JSON.parse(response.body)["persisted"]
    layouts = JSON.parse(
      File.read(File.join(@inventory, "inventory", "ui-layouts.json"))
    )
    assert_equal 12.5, layouts.dig("Module.Flow", 0, "x")
  end

  def test_rejects_unknown_layout_and_marketplace_install
    unknown = post_json("/api/layout", qn: "Module.Missing", positions: [])
    assert_equal "404", unknown.code

    install = post_json("/api/marketplace/install", id: "1866")
    assert_equal "403", install.code
    refute JSON.parse(install.body)["ok"]
  end

  def test_git_routes_report_unavailable_without_a_tracked_project
    health = get_json("/api/health")
    assert_equal false, health.dig("capabilities", "git")

    status = Net::HTTP.get_response(uri("/api/git/status"))
    assert_equal "503", status.code
    assert JSON.parse(status.body)["error"]

    switch = post_json("/api/git/switch", branch: "main", studio_closed: true)
    assert_equal "503", switch.code
  end

  def test_saves_visual_entity_plan_without_modifying_project
    response = post_json(
      "/api/entity-plan",
      qn: "Module.Customer",
      persistable: true,
      attributes: [
        { name: "Name", type: "string", length: 200, required: false }
      ]
    )

    assert_equal "200", response.code
    result = JSON.parse(response.body)
    assert_equal "modify", result.dig("operation", "action")
    assert_includes result["mdl"], "Module.Customer"
    plans = JSON.parse(
      File.read(File.join(@inventory, "inventory", "visual-plans.json"))
    )
    assert_equal "Module.Customer", plans.dig("Module.Customer", "request", "qn")
  end

  def test_saves_a_built_page_draft
    response = post_json(
      "/api/page",
      qn: "Module.Home",
      content: "dataview dv1 (DataSource: $object) {\n  textbox tb (Attribute: Name)\n}"
    )

    assert_equal "200", response.code
    body = JSON.parse(response.body)
    assert body["ok"]
    assert_includes body["mdl"], "CREATE OR MODIFY PAGE Module.Home"
    assert_includes body["mdl"], "Title: 'Home'"
    assert_includes body["mdl"], "textbox tb"

    drafts = JSON.parse(File.read(File.join(@inventory, "inventory", "page-plans.json")))
    assert_equal true, drafts.dig("Module.Home", "valid")
    assert_includes drafts.dig("Module.Home", "content"), "dataview dv1"

    unknown = post_json("/api/page", qn: "Module.Missing", content: "")
    assert_equal "404", unknown.code
  end

  def test_lists_saved_drafts
    post_json(
      "/api/page",
      qn: "Module.Home",
      content: "container c1 {\n  dynamictext t1 (Content: 'Hi')\n}"
    )

    drafts = get_json("/api/drafts")
    assert drafts.key?("entities")
    assert_includes drafts["pages"].keys, "Module.Home"
  end

  def test_saves_a_rebuilt_flow_draft
    response = post_json(
      "/api/flow",
      qn: "Module.ACT_Save",
      body: "  @position(10, 20)\n  return true;"
    )

    assert_equal "200", response.code
    body = JSON.parse(response.body)
    assert body["ok"]
    assert_includes body["mdl"], "CREATE OR MODIFY MICROFLOW Module.ACT_Save ($Customer: Module.Customer)"
    assert_includes body["mdl"], "RETURNS Boolean"
    assert_includes body["mdl"], "FOLDER 'Actions'"
    assert_includes body["mdl"], "return true;"

    drafts = get_json("/api/drafts")
    assert_equal true, drafts.dig("flows", "Module.ACT_Save", "valid")

    unknown = post_json("/api/flow", qn: "Module.Missing", body: "")
    assert_equal "404", unknown.code
  end

  def test_health_reports_page_drafts_capability
    health = get_json("/api/health")
    assert_equal true, health.dig("capabilities", "page_drafts")
    assert_equal true, health.dig("capabilities", "apply_drafts")
  end

  def test_applies_a_valid_page_draft
    post_json(
      "/api/page",
      qn: "Module.Home",
      content: "container c1 {\n  dynamictext t1 (Content: 'Hi')\n}"
    )
    drafts_before = get_json("/api/drafts")
    assert_includes drafts_before["pages"].keys, "Module.Home"

    response = post_json(
      "/api/apply",
      qn: "Module.Home",
      type: "page",
      studio_closed: true
    )
    body = JSON.parse(response.body)
    assert_equal "200", response.code
    assert body["ok"], body.inspect

    drafts_after = get_json("/api/drafts")
    refute_includes drafts_after["pages"].keys, "Module.Home"
  end

  def test_applies_a_valid_flow_draft
    post_json(
      "/api/flow",
      qn: "Module.ACT_Save",
      body: "  @position(10, 20)\n  return true;"
    )
    response = post_json(
      "/api/apply",
      qn: "Module.ACT_Save",
      type: "flow",
      studio_closed: true
    )
    body = JSON.parse(response.body)
    assert_equal "200", response.code
    assert body["ok"], body.inspect

    drafts_after = get_json("/api/drafts")
    refute_includes(drafts_after.dig("flows") || {}, "Module.ACT_Save")
  end

  def test_apply_requires_studio_closed_and_known_draft
    response = post_json("/api/apply", qn: "Module.Home", type: "page", studio_closed: false)
    assert_equal "403", response.code

    response = post_json("/api/apply", qn: "Module.Home", type: "page", studio_closed: true)
    assert_equal "404", response.code
  end

  def test_xas_status_disabled_by_default
    status = get_json("/api/xas/status")
    assert_equal false, status["enabled"]
    assert_equal 0, status["log_size"]
    assert_equal 8080, status["target_port"]
  end

  def test_xas_proxy_returns_503_when_disabled
    response = post_json("/xas/", action: "get_session_data", params: {})
    assert_equal "503", response.code
    assert_includes JSON.parse(response.body)["error"], "not enabled"
  end

  def test_xas_enable_disable_and_clear
    enable_response = post_json("/api/xas/enable", port: 19_999)
    assert_equal "200", enable_response.code
    assert JSON.parse(enable_response.body)["ok"]

    status = get_json("/api/xas/status")
    assert_equal true, status["enabled"]
    assert_equal 19_999, status["target_port"]

    post_json("/api/xas/disable", {})
    status = get_json("/api/xas/status")
    assert_equal false, status["enabled"]
  end

  def test_xas_enable_without_port_falls_back_to_docker_env
    env_dir = File.join(@root, "project_docker", ".docker")
    FileUtils.mkdir_p(env_dir)
    File.write(File.join(env_dir, ".env"), "APP_PORT=9090\n")
    @mpr2 = File.join(@root, "project_docker", "app.mpr")
    File.write(@mpr2, "")
    write_json("mendix-project.json",
      "element_count" => 1,
      "imported_at" => "2026-07-28T00:00:00Z",
      "source_project" => @mpr2)

    enable_response = post_json("/api/xas/enable", {})
    assert_equal "200", enable_response.code
    body = JSON.parse(enable_response.body)
    assert body["ok"]
    assert_includes body["message"], "9090"
  ensure
    write_json("mendix-project.json",
      "element_count" => 1,
      "imported_at" => "2026-07-24T00:00:00Z",
      "source_project" => @mpr)
    post_json("/api/xas/disable", {})
  end

  def test_xas_proxy_forwards_and_logs
    with_fake_mendix_runtime do |runtime_port, recorded_requests|
      post_json("/api/xas/enable", port: runtime_port)

      xas_response = post_json(
        "/xas/",
        action: "retrieve_by_xpath",
        params: { xpath: "//Module.Customer", options: { offset: 0, amount: 20 } }
      )

      assert_equal "200", xas_response.code
      response_body = JSON.parse(xas_response.body)
      assert_equal "ok", response_body["status"]

      assert_equal 1, recorded_requests.size
      assert_equal "retrieve_by_xpath", JSON.parse(recorded_requests.first)["action"]

      log = get_json("/api/xas/log")
      assert_equal 1, log["total"]
      entry = log["entries"].first
      assert_equal "retrieve_by_xpath", entry["action"]
      assert_equal 200, entry["status"]
      assert_equal "ok", entry.dig("response", "status")
    end
  ensure
    post_json("/api/xas/disable", {})
  end

  def test_xas_log_filtering_and_clear
    with_fake_mendix_runtime do |runtime_port, _|
      post_json("/api/xas/enable", port: runtime_port)

      post_json("/xas/", action: "login",  params: {})
      post_json("/xas/", action: "commit", params: {})
      post_json("/xas/", action: "login",  params: {})

      all = get_json("/api/xas/log")
      assert_equal 3, all["total"]

      filtered = get_json("/api/xas/log?action=login")
      assert_equal 2, filtered["entries"].size
      assert filtered["entries"].all? { |e| e["action"] == "login" }

      limited = get_json("/api/xas/log?limit=1")
      assert_equal 1, limited["entries"].size

      post_json("/api/xas/clear", {})
      assert_equal 0, get_json("/api/xas/log")["total"]
    end
  ensure
    post_json("/api/xas/disable", {})
  end

  def test_xas_proxy_returns_502_when_runtime_unreachable
    post_json("/api/xas/enable", port: 1)   # porta 1 sempre recusa
    response = post_json("/xas/", action: "login", params: {})
    assert_equal "502", response.code
    assert_includes JSON.parse(response.body)["error"], "not reachable"
  ensure
    post_json("/api/xas/disable", {})
  end

  private

  def write_json(relative, value)
    File.write(
      File.join(@inventory, relative),
      "#{JSON.pretty_generate(value)}\n"
    )
  end

  def uri(path)
    URI("http://127.0.0.1:#{@server.port}#{path}")
  end

  def get_json(path)
    JSON.parse(Net::HTTP.get(uri(path)))
  end

  def post_json(path, body)
    request = Net::HTTP::Post.new(uri(path))
    request["content-type"] = "application/json"
    request.body = JSON.generate(body)
    Net::HTTP.start(uri(path).host, uri(path).port) { |http| http.request(request) }
  end

  def wait_until_ready
    50.times do
      TCPSocket.new("127.0.0.1", @server.port).close
      return
    rescue Errno::ECONNREFUSED
      sleep 0.01
    end
    flunk "backend server did not start"
  end

  # Spins up a minimal WEBrick server that acts as a fake Mendix runtime.
  # Responds to POST /xas/ with {"status":"ok"} and records every raw request
  # body in the `recorded` array. Yields [port, recorded] to the block and
  # shuts down cleanly afterward.
  def with_fake_mendix_runtime
    require "webrick"
    recorded = []
    fake = WEBrick::HTTPServer.new(
      BindAddress: "127.0.0.1",
      Port: 0,
      Logger: WEBrick::Log.new(File::NULL),
      AccessLog: []
    )
    fake.mount_proc("/xas/") do |request, response|
      recorded << request.body.to_s
      response.status = 200
      response["content-type"] = "application/json"
      response.body = JSON.generate({ status: "ok" })
    end
    thread = Thread.new { fake.start }
    port = fake.listeners.first.addr[1]
    50.times do
      TCPSocket.new("127.0.0.1", port).close
      break
    rescue Errno::ECONNREFUSED
      sleep 0.01
    end
    yield port, recorded
  ensure
    fake&.shutdown
    thread&.join(2)
  end
end
