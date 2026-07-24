# frozen_string_literal: true

require "fileutils"
require "minitest/autorun"
require "tmpdir"
require_relative "../lib/mendix_bridge"

class GitWorkflowTest < Minitest::Test
  def setup
    @directory = Dir.mktmpdir("mendix-git-workflow-")
    @project = File.join(@directory, "Example.mpr")
    FileUtils.mkdir_p(File.join(@directory, "mprcontents"))
    File.write(@project, "mpr")
    File.write(File.join(@directory, "mprcontents", "model.mxunit"), "model")
    git("init", "-b", "main")
    git("config", "user.name", "Test User")
    git("config", "user.email", "test@example.com")
    git("add", ".")
    git("commit", "-m", "Initial setup")
  end

  def teardown
    FileUtils.remove_entry(@directory)
  end

  def test_creates_and_switches_branches_only_from_a_clean_tree
    workflow = MendixBridge::GitWorkflow.new(@project, mx: "/usr/bin/true")

    result = workflow.create("feature/customer", studio_closed: true)
    assert_equal "feature/customer", result["branch"]
    assert_equal true, result["ready_to_switch"]

    result = workflow.switch("main", studio_closed: true)
    assert_equal "main", result["branch"]

    File.write(@project, "dirty")
    error = assert_raises(MendixBridge::GitWorkflowError) do
      workflow.switch("feature/customer", studio_closed: true)
    end
    assert_match "working tree is dirty", error.message
    assert_equal "main", workflow.status["branch"]
  end

  def test_requires_explicit_confirmation_that_studio_pro_is_closed
    workflow = MendixBridge::GitWorkflow.new(@project, mx: "/usr/bin/true")

    error = assert_raises(MendixBridge::GitWorkflowError) do
      workflow.create("feature/customer", studio_closed: false)
    end

    assert_match "--studio-closed", error.message
    assert_equal "main", workflow.status["branch"]
  end

  private

  def git(*arguments)
    system("git", "-C", @directory, *arguments, out: File::NULL, err: File::NULL) ||
      raise("git #{arguments.join(' ')} failed")
  end
end
