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

  def test_create_branch_can_carry_uncommitted_changes
    workflow = MendixBridge::GitWorkflow.new(@project, mx: "/usr/bin/true")
    File.write(@project, "work in progress")
    File.write(File.join(@directory, "untracked.txt"), "new")

    result = workflow.create(
      "feature/carry",
      studio_closed: true,
      carry_changes: true
    )

    assert_equal "feature/carry", result["branch"]
    assert_equal true, result["carried_changes"]
    assert_equal false, result["stashed_changes"]
    assert_equal "work in progress", File.read(@project)
    assert File.exist?(File.join(@directory, "untracked.txt"))
    assert_equal "", workflow.stash_list
  end

  def test_create_branch_does_not_depend_on_existing_mendix_consistency_errors
    workflow = MendixBridge::GitWorkflow.new(@project, mx: "/usr/bin/false")
    File.write(@project, "model with an existing consistency error")

    result = workflow.create(
      "feature/git-only",
      studio_closed: true,
      carry_changes: true
    )

    assert_equal "feature/git-only", result["branch"]
    assert_equal "model with an existing consistency error", File.read(@project)
  end

  def test_create_branch_can_keep_changes_in_an_automatic_stash
    workflow = MendixBridge::GitWorkflow.new(@project, mx: "/usr/bin/true")
    File.write(@project, "work in progress")
    File.write(File.join(@directory, "untracked.txt"), "new")

    result = workflow.create(
      "feature/clean",
      studio_closed: true,
      carry_changes: false
    )

    assert_equal "feature/clean", result["branch"]
    assert_equal false, result["carried_changes"]
    assert_equal true, result["stashed_changes"]
    assert_equal true, result["clean"]
    refute File.exist?(File.join(@directory, "untracked.txt"))
    assert_includes workflow.stash_list, "Before creating feature/clean"
  end

  def test_embedded_terminal_runs_git_commands_and_guards_mutations
    workflow = MendixBridge::GitWorkflow.new(@project, mx: "/usr/bin/true")

    result = workflow.terminal_command("git status --short", studio_closed: false)
    assert_equal true, result["ok"]
    assert_equal "git status --short", result["command"]

    error = assert_raises(MendixBridge::GitWorkflowError) do
      workflow.terminal_command("git branch feature/cli", studio_closed: false)
    end
    assert_match "--studio-closed", error.message

    result = workflow.terminal_command("git branch feature/cli", studio_closed: true)
    assert_equal true, result["ok"]
    assert_includes workflow.branches, "feature/cli"

    error = assert_raises(MendixBridge::GitWorkflowError) do
      workflow.terminal_command("sh -c whoami", studio_closed: true)
    end
    assert_match "unsupported git command", error.message
  end

  def test_stash_pop_validates_before_dropping_the_stash
    workflow = MendixBridge::GitWorkflow.new(@project, mx: "/usr/bin/true")
    File.write(@project, "stashed change")

    result = workflow.stash_push(
      studio_closed: true,
      message: "Mendix work"
    )
    assert_equal true, result["clean"]
    assert_includes workflow.stash_list, "Mendix work"

    result = workflow.stash_apply(studio_closed: true, drop: true)
    assert_equal false, result["clean"]
    assert_equal "", workflow.stash_list
    assert_equal "stashed change", File.read(@project)
  end

  def test_failed_stash_validation_preserves_the_stash
    workflow = MendixBridge::GitWorkflow.new(@project, mx: "/usr/bin/true")
    File.write(@project, "invalid model")
    workflow.stash_push(studio_closed: true, message: "Preserve me")

    failing_workflow = MendixBridge::GitWorkflow.new(@project, mx: "/usr/bin/false")
    error = assert_raises(MendixBridge::GitWorkflowError) do
      failing_workflow.stash_apply(studio_closed: true, drop: true)
    end

    assert_match "stash was preserved", error.message
    assert_includes workflow.stash_list, "Preserve me"
    assert_equal "invalid model", File.read(@project)
  end

  def test_commit_stages_the_project_and_rejects_an_empty_commit
    workflow = MendixBridge::GitWorkflow.new(@project, mx: "/usr/bin/true")
    File.write(@project, "edited model")

    result = workflow.commit("Update model", studio_closed: true)
    assert_equal true, result["clean"]
    assert_equal "Update model", `git -C #{@directory} log -1 --format=%s`.strip

    error = assert_raises(MendixBridge::GitWorkflowError) do
      workflow.commit("nothing staged", studio_closed: true)
    end
    assert_match "nothing to commit", error.message
  end

  def test_merges_and_rebases_with_project_validation
    workflow = MendixBridge::GitWorkflow.new(@project, mx: "/usr/bin/true")
    workflow.create("feature/merge", studio_closed: true)
    File.write(@project, "merged")
    git("add", ".")
    git("commit", "-m", "Change model")
    workflow.switch("main", studio_closed: true)

    result = workflow.merge("feature/merge", studio_closed: true)
    assert_equal "main", result["branch"]
    assert_equal "merged", File.read(@project)
    assert_equal true, result["clean"]

    workflow.create("feature/rebase", studio_closed: true)
    File.write(File.join(@directory, "topic.txt"), "topic")
    git("add", ".")
    git("commit", "-m", "Add topic")
    git("branch", "new-base", "main")
    git("switch", "new-base")
    File.write(File.join(@directory, "base.txt"), "base")
    git("add", ".")
    git("commit", "-m", "Advance base")
    git("switch", "feature/rebase")

    result = workflow.rebase("new-base", studio_closed: true)
    assert_equal "feature/rebase", result["branch"]
    assert_equal true, result["clean"]
    assert_equal "base", File.read(File.join(@directory, "base.txt"))
    assert_equal "topic", File.read(File.join(@directory, "topic.txt"))
  end

  def test_reports_log_and_staged_and_unstaged_file_status
    workflow = MendixBridge::GitWorkflow.new(@project, mx: "/usr/bin/true")
    File.write(@project, "edited model")
    File.write(File.join(@directory, "new.txt"), "new")
    workflow.stage("Example.mpr")

    files = workflow.file_status.to_h { |entry| [entry["path"], entry] }
    assert_equal "M", files.fetch("Example.mpr")["index_status"]
    assert_equal "?", files.fetch("new.txt")["worktree_status"]

    commit = workflow.log(max: 1).first
    assert_equal "Initial setup", commit["subject"]
    assert_equal 40, commit["sha"].length
    assert_equal [], commit["parents"]
    assert_equal [], workflow.tags

    worktree = workflow.worktrees.first
    assert_equal @directory, worktree["path"]
    assert_equal "main", worktree["branch"]
    assert_equal commit["sha"], worktree["sha"]
  end

  def test_commits_only_staged_changes_and_can_create_branch_at_a_commit
    workflow = MendixBridge::GitWorkflow.new(@project, mx: "/usr/bin/true")
    initial_sha = `git -C #{@directory} rev-parse HEAD`.strip
    File.write(@project, "staged model")
    File.write(File.join(@directory, "unstaged.txt"), "unstaged")
    workflow.stage("Example.mpr")

    result = workflow.commit_staged("Only the model", studio_closed: true)
    assert_equal false, result["clean"]
    assert_equal "Only the model", `git -C #{@directory} log -1 --format=%s`.strip
    assert File.exist?(File.join(@directory, "unstaged.txt"))

    git("add", "unstaged.txt")
    git("commit", "-m", "Clean remaining file")
    result = workflow.create("from-initial", studio_closed: true, start_point: initial_sha)
    assert_equal "from-initial", result["branch"]
    assert_equal initial_sha, `git -C #{@directory} rev-parse HEAD`.strip
  end

  def test_refuses_to_discard_a_path_outside_the_repository
    workflow = MendixBridge::GitWorkflow.new(@project, mx: "/usr/bin/true")

    error = assert_raises(MendixBridge::GitWorkflowError) do
      workflow.discard("../outside.txt")
    end
    assert_match "outside the Git repository", error.message
  end

  private

  def git(*arguments)
    system("git", "-C", @directory, *arguments, out: File::NULL, err: File::NULL) ||
      raise("git #{arguments.join(' ')} failed")
  end
end
