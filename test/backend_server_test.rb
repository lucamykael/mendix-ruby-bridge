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
      }
    )
    write_json("inventory/dependencies.json", "schema_version" => 1, "nodes" => 1, "edges" => [])
    write_json("mendix-project.json", "element_count" => 1, "imported_at" => "2026-07-24T00:00:00Z")
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

  def test_health_reports_page_drafts_capability
    assert_equal true, get_json("/api/health").dig("capabilities", "page_drafts")
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
end
