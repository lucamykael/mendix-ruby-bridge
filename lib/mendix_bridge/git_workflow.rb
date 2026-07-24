# frozen_string_literal: true

require "open3"
require "pathname"
require "shellwords"

module MendixBridge
  class GitWorkflowError < StandardError; end

  class GitWorkflow
    IN_PROGRESS_MARKERS = %w[
      MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD REBASE_HEAD
      rebase-merge rebase-apply BISECT_LOG
    ].freeze

    def initialize(project_file, inventory_dir: nil, mxcli: nil, mx: nil)
      @project_file = File.expand_path(project_file)
      @project_dir = File.dirname(@project_file)
      @inventory_dir = inventory_dir && File.expand_path(inventory_dir)
      @root = git!("rev-parse", "--show-toplevel").strip
      @git_dir = git!("rev-parse", "--absolute-git-dir").strip
      @mxcli = mxcli
      @mx = mx || resolve_mx
      verify_project_tracking!
    end

    attr_reader :root

    def status
      {
        "branch" => current_branch,
        "clean" => clean?,
        "operation_in_progress" => operation_in_progress,
        "project" => @project_file,
        "project_tracked" => tracked?(@project_file),
        "mprcontents_tracked" => mprcontents_tracked?,
        "ready_to_switch" => clean? && operation_in_progress.nil?
      }
    end

    def branches
      git!("for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes")
        .lines.map(&:strip).reject { |name| name.end_with?("/HEAD") }
    end

    def fetch
      git!("fetch", "--prune", "origin")
    end

    def switch(branch, studio_closed:)
      ensure_switch_ready!(branch, studio_closed:)
      previous = current_branch
      switched = false

      if local_branch?(branch)
        git!("switch", branch)
      elsif remote_branch?(branch)
        git!("switch", "--track", "-c", branch, "origin/#{branch}")
      else
        raise GitWorkflowError, "branch does not exist locally or at origin: #{branch}"
      end
      switched = true
      validate_and_refresh!
      status
    rescue StandardError => error
      rollback(previous) if switched
      raise error
    end

    def create(branch, studio_closed:)
      ensure_switch_ready!(branch, studio_closed:)
      raise GitWorkflowError, "branch already exists: #{branch}" if local_branch?(branch) || remote_branch?(branch)

      previous = current_branch
      switched = false
      git!("switch", "-c", branch)
      switched = true
      validate_and_refresh!
      status
    rescue StandardError => error
      rollback(previous) if switched
      raise error
    end

    def stash_push(studio_closed:, message: nil, include_untracked: false)
      ensure_studio_closed!(studio_closed)
      ensure_no_operation!

      arguments = ["stash", "push"]
      arguments << "--include-untracked" if include_untracked
      arguments.concat(["-m", message]) if message
      output = git!(*arguments)
      { "output" => output.strip, **status }
    end

    def stash_list
      git!("stash", "list")
    end

    def stash_show(reference = "stash@{0}")
      git!("stash", "show", "--stat", reference)
    end

    def stash_apply(reference = "stash@{0}", studio_closed:, drop: false)
      ensure_switch_ready!(current_branch, studio_closed:)
      output, error, result = Open3.capture3(
        "git", "-C", @root, "stash", "apply", "--index", reference
      )
      unless result.success?
        raise GitWorkflowError,
          "stash apply has conflicts; the stash was preserved:\n#{error}#{output}"
      end

      begin
        validate_project!
        refresh_inventory! if @inventory_dir
      rescue StandardError => validation_error
        raise GitWorkflowError,
          "#{validation_error.message}\nthe stash was preserved and its changes remain in the working tree"
      end

      git!("stash", "drop", reference) if drop
      status
    end

    def stash_drop(reference = "stash@{0}")
      git!("stash", "drop", reference).strip
    end

    def merge(branch, studio_closed:)
      ensure_switch_ready!(branch, studio_closed:)
      output, error, result = Open3.capture3(
        "git", "-C", @root, "merge", "--no-ff", "--no-commit", branch
      )
      unless result.success?
        raise GitWorkflowError,
          "merge has conflicts; resolve them or run git merge --abort:\n#{error}#{output}"
      end

      begin
        validate_project!
      rescue StandardError => validation_error
        raise GitWorkflowError,
          "#{validation_error.message}\nmerge was not committed; run git merge --abort"
      end

      git!("commit", "--no-edit")
      refresh_inventory! if @inventory_dir
      status
    end

    def rebase(branch, studio_closed:)
      ensure_switch_ready!(branch, studio_closed:)
      validation = [
        Shellwords.escape(@mx),
        "check",
        Shellwords.escape(@project_file)
      ].join(" ")
      output, error, result = Open3.capture3(
        "git", "-C", @root, "rebase", "--exec", validation, branch
      )
      unless result.success?
        raise GitWorkflowError,
          "rebase stopped; resolve the issue and continue, or run git rebase --abort:\n#{error}#{output}"
      end

      refresh_inventory! if @inventory_dir
      status
    end

    # Stages the Mendix project directory and commits it. Deliberately skips the
    # `mx check` consistency validation so work-in-progress (even inconsistent)
    # state can be committed; branch switches still guard against a dirty tree.
    def commit(message, studio_closed:)
      ensure_studio_closed!(studio_closed)
      ensure_no_operation!
      message = message.to_s.strip
      raise GitWorkflowError, "commit message cannot be empty" if message.empty?
      verify_project_tracking!

      git!("add", "--", project_pathspec)
      raise GitWorkflowError, "nothing to commit; the project has no staged changes" if
        git!("diff", "--cached", "--name-only").strip.empty?

      git!("commit", "-m", message)
      status
    end

    private

    def project_pathspec
      relative = Pathname.new(@project_dir).relative_path_from(Pathname.new(@root)).to_s
      relative == "." ? "." : relative
    end

    def ensure_switch_ready!(branch, studio_closed:)
      ensure_studio_closed!(studio_closed)
      raise GitWorkflowError, "working tree is dirty; commit or stash changes first" unless clean?
      ensure_no_operation!

      _output, error, status = Open3.capture3("git", "check-ref-format", "--branch", branch)
      raise GitWorkflowError, "invalid branch name: #{branch} (#{error.strip})" unless status.success?
    end

    def validate_and_refresh!
      validate_project!
      refresh_inventory! if @inventory_dir
    end

    def validate_project!
      raise GitWorkflowError, "project file is absent on branch #{current_branch}" unless File.file?(@project_file)
      verify_project_tracking!

      output, error, status = Open3.capture3(@mx, "check", @project_file, chdir: @project_dir)
      unless status.success?
        raise GitWorkflowError, "Mendix consistency check failed:\n#{error}#{output}"
      end
    end

    def refresh_inventory!
      raise GitWorkflowError, "mxcli is required to refresh the inventory" unless @mxcli

      metadata_file = File.join(@inventory_dir, "mendix-project.json")
      raise GitWorkflowError, "not an imported inventory: #{@inventory_dir}" unless File.file?(metadata_file)

      metadata = JSON.parse(File.read(metadata_file))
      unless File.realpath(metadata.fetch("source_project")) == File.realpath(@project_file)
        raise GitWorkflowError, "inventory belongs to a different Mendix project"
      end

      _inventory, warnings = Importer.new(mxcli: @mxcli).import(@project_file, @inventory_dir)
      return if warnings.empty?

      raise GitWorkflowError, "inventory refresh had #{warnings.length} description errors"
    end

    def rollback(previous)
      git!("switch", previous) if clean? && current_branch != previous
    rescue GitWorkflowError
      nil
    end

    def ensure_studio_closed!(studio_closed)
      raise GitWorkflowError, "confirm Studio Pro is closed with --studio-closed" unless studio_closed
    end

    def ensure_no_operation!
      return unless operation_in_progress

      raise GitWorkflowError, "Git operation in progress: #{operation_in_progress}"
    end

    def resolve_mx
      version_file = File.join(@project_dir, ".mendix-version")
      raise GitWorkflowError, "missing #{version_file}" unless File.file?(version_file)

      version = File.read(version_file).strip
      executable = File.join(Dir.home, ".mxcli", "mxbuild", version, "modeler", "mx")
      raise GitWorkflowError, "Mendix mx #{version} is not installed: #{executable}" unless File.executable?(executable)

      executable
    end

    def verify_project_tracking!
      raise GitWorkflowError, "Mendix project does not exist: #{@project_file}" unless File.file?(@project_file)
      raise GitWorkflowError, "project is outside its Git repository" unless inside_root?(@project_file)
      raise GitWorkflowError, "the .mpr is not tracked by Git" unless tracked?(@project_file)
      raise GitWorkflowError, "mprcontents has no tracked files" unless mprcontents_tracked?
    end

    def inside_root?(path)
      path == @root || path.start_with?("#{@root}/")
    end

    def tracked?(path)
      relative = path.delete_prefix("#{@root}/")
      _output, _error, status = Open3.capture3("git", "-C", @root, "ls-files", "--error-unmatch", relative)
      status.success?
    end

    def mprcontents_tracked?
      return true unless Dir.exist?(File.join(@project_dir, "mprcontents"))

      relative_dir = Pathname.new(@project_dir).relative_path_from(Pathname.new(@root)).to_s
      pathspec = relative_dir == "." ? "mprcontents" : File.join(relative_dir, "mprcontents")
      !git!("ls-files", pathspec).strip.empty?
    end

    def clean?
      git!("status", "--porcelain").empty?
    end

    def current_branch
      git!("branch", "--show-current").strip
    end

    def operation_in_progress
      IN_PROGRESS_MARKERS.find { |marker| File.exist?(File.join(@git_dir, marker)) }
    end

    def local_branch?(branch)
      ref_exists?("refs/heads/#{branch}")
    end

    def remote_branch?(branch)
      ref_exists?("refs/remotes/origin/#{branch}")
    end

    def ref_exists?(ref)
      _output, _error, status = Open3.capture3("git", "-C", @root, "show-ref", "--verify", "--quiet", ref)
      status.success?
    end

    def git!(*arguments)
      output, error, status = Open3.capture3("git", "-C", @root || @project_dir, *arguments)
      return output if status.success?

      raise GitWorkflowError, "git #{arguments.join(' ')} failed: #{error.strip}"
    end
  end
end
