# frozen_string_literal: true

require "fileutils"
require "json"
require "minitest/autorun"
require "open3"
require "rbconfig"
require "tmpdir"
require_relative "../lib/mendix_bridge"

class CLITest < Minitest::Test
  ROOT = File.expand_path("..", __dir__)
  CLI = File.join(ROOT, "bin", "mendix-ruby")

  def test_compiles_example_to_mdl
    stdout, stderr, status = run_cli(
      "compile",
      File.join(ROOT, "examples", "customer_app.rb"),
      "--format", "mdl"
    )

    assert status.success?, stderr
    assert_includes stdout, "CREATE OR MODIFY PERSISTENT ENTITY CRM.Customer"
  end

  def test_prints_package_version
    stdout, stderr, status = run_cli("--version")

    assert status.success?, stderr
    assert_equal MendixBridge::VERSION, stdout.strip
  end

  def test_uses_configuration_from_parent_directory
    Dir.mktmpdir do |directory|
      inventory = build_inventory(directory)
      project = File.join(directory, "App.mpr")
      File.write(project, "")
      model = File.join(ROOT, "examples", "customer_app.rb")

      _stdout, stderr, status = run_cli(
        "configure",
        "--project", project,
        "--inventory", inventory,
        "--model", model,
        chdir: directory
      )
      assert status.success?, stderr

      nested = File.join(directory, "nested")
      FileUtils.mkdir_p(nested)
      stdout, stderr, status = run_cli(
        "deps", "CRM.Customer", "--json",
        chdir: nested
      )

      assert status.success?, stderr
      assert_equal "CRM.Customer", JSON.parse(stdout).fetch("element")
    end
  end

  private

  def run_cli(*arguments, chdir: ROOT)
    Open3.capture3(RbConfig.ruby, CLI, *arguments, chdir:)
  end

  def build_inventory(directory)
    inventory = File.join(directory, "inventory-project")
    inventory_dir = File.join(inventory, "inventory")
    FileUtils.mkdir_p(inventory_dir)
    tree = [
      {
        "label" => "CRM",
        "type" => "module",
        "qualifiedName" => "CRM",
        "children" => [
          {
            "label" => "Customer",
            "type" => "entity",
            "qualifiedName" => "CRM.Customer"
          }
        ]
      }
    ]
    File.write(File.join(inventory_dir, "project-tree.json"), JSON.generate(tree))
    File.write(File.join(inventory_dir, "element-details.json"), "{}")
    inventory
  end
end
