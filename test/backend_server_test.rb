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
    write_json("inventory/project-tree.json", [])
    write_json(
      "inventory/element-details.json",
      "Module.Flow" => { "kind" => "microflow", "mdl" => "BEGIN\nEND" }
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

    assert_equal [], get_json("/inventory/project-tree.json")
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
