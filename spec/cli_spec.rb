# frozen_string_literal: true

require "fileutils"
require "json"
require "open3"
require "rbconfig"
require "spec_helper"
require "tmpdir"

RSpec.describe "mendix-ruby CLI" do
  let(:root) { File.expand_path("..", __dir__) }
  let(:cli) { File.join(root, "bin", "mendix-ruby") }

  def run_cli(*arguments, chdir: root)
    Open3.capture3(RbConfig.ruby, cli, *arguments, chdir:)
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

  it "compiles an example to MDL" do
    stdout, stderr, status = run_cli(
      "compile",
      File.join(root, "examples", "customer_app.rb"),
      "--format", "mdl"
    )

    expect(status).to be_success, stderr
    expect(stdout).to include("CREATE OR MODIFY PERSISTENT ENTITY CRM.Customer")
  end

  it "prints the package version" do
    stdout, stderr, status = run_cli("--version")

    expect(status).to be_success, stderr
    expect(stdout.strip).to eq(MendixBridge::VERSION)
  end

  it "uses configuration discovered from a parent directory" do
    Dir.mktmpdir do |directory|
      inventory = build_inventory(directory)
      project = File.join(directory, "App.mpr")
      File.write(project, "")
      model = File.join(root, "examples", "customer_app.rb")

      _stdout, stderr, status = run_cli(
        "configure",
        "--project", project,
        "--inventory", inventory,
        "--model", model,
        chdir: directory
      )
      expect(status).to be_success, stderr

      nested = File.join(directory, "nested")
      FileUtils.mkdir_p(nested)
      stdout, stderr, status = run_cli(
        "deps", "CRM.Customer", "--json",
        chdir: nested
      )

      expect(status).to be_success, stderr
      expect(JSON.parse(stdout).fetch("element")).to eq("CRM.Customer")
    end
  end
end
