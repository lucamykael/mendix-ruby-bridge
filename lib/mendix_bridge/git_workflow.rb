# frozen_string_literal: true

require "fileutils"
require "open3"
require "pathname"
require "shellwords"
require "timeout"

module MendixBridge
  class GitWorkflowError < StandardError; end

  class GitWorkflow
    IN_PROGRESS_MARKERS = %w[
      MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD REBASE_HEAD
      rebase-merge rebase-apply BISECT_LOG
    ].freeze

    def initialize(project_file, inventory_dir: nil, mxcli: nil, mx: nil,
                   runner: MxrbRunner.new)
      @project_file = File.expand_path(project_file)
      @project_dir = File.dirname(@project_file)
      @inventory_dir = inventory_dir && File.expand_path(inventory_dir)
      @root = git!("rev-parse", "--show-toplevel").strip
      @git_dir = git!("rev-parse", "--absolute-git-dir").strip
      @runner = runner
      # Legacy args kept for backward compatibility but not used
      @mxcli = mxcli
      @mx = mx
      verify_project_tracking!
    end

    attr_reader :root

    def status
      {
        "branch"               => current_branch,
        "clean"                => clean?,
        "operation_in_progress" => operation_in_progress,
        "project"              => @project_file,
        "project_tracked"      => tracked?(@project_file),
        "mprcontents_tracked"  => mprcontents_tracked?,
        "ready_to_switch"      => clean? && operation_in_progress.nil?
      }
    end

    def branches
      git!("for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes")
        .lines.map(&:strip).reject { |name| name.end_with?("/HEAD") }
    end

    def tags
      git!("tag", "--list", "--sort=-creatordate").lines.map(&:strip).reject(&:empty?)
    end

    def worktrees
      records = []
      current = {}
      git!("worktree", "list", "--porcelain").each_line do |line|
        line = line.chomp
        if line.empty?
          records << current unless current.empty?
          current = {}
        elsif line.start_with?("worktree ")
          current["path"] = line.delete_prefix("worktree ")
        elsif line.start_with?("HEAD ")
          current["sha"] = line.delete_prefix("HEAD ")
        elsif line.start_with?("branch ")
          current["branch"] = line.delete_prefix("branch refs/heads/")
        elsif line == "detached"
          current["detached"] = true
        elsif line == "prunable"
          current["prunable"] = true
        elsif line.start_with?("locked")
          current["locked"] = true
        end
      end
      records << current unless current.empty?
      records
    end

    def fetch
      git!("fetch", "--prune", "origin")
    end

    def remote_names
      git!("remote").lines.map(&:strip).reject(&:empty?)
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
      git!("switch", previous) if switched && current_branch != previous
      raise error
    end

    def create(branch, studio_closed:, start_point: nil, carry_changes: false)
      ensure_studio_closed!(studio_closed)
      ensure_no_operation!
      validate_branch_name!(branch)
      raise GitWorkflowError, "branch already exists: #{branch}" if local_branch?(branch) || remote_branch?(branch)

      previous = current_branch
      switched = false
      stashed = false
      if !clean? && !carry_changes
        git!("stash", "push", "--include-untracked", "-m", "Before creating #{branch}")
        stashed = true
      end
      arguments = ["switch", "-c", branch]
      arguments << start_point if start_point
      git!(*arguments)
      switched = true
      # Creating a ref does not change the project contents. Existing Mendix
      # consistency errors must not make Git undo an otherwise valid branch.
      { **status, "carried_changes" => !clean?, "stashed_changes" => stashed }
    rescue StandardError => error
      begin
        git!("switch", previous) if switched && current_branch != previous
        git!("stash", "pop", "--index") if stashed
      rescue GitWorkflowError
        # Keep the original error; the named automatic stash remains recoverable.
      end
      raise error
    end

    TERMINAL_SUBCOMMANDS = %w[
      status diff log show blame branch switch checkout add restore reset commit
      fetch pull push merge rebase cherry-pick revert stash tag remote worktree
      rev-parse reflog clean mv rm grep shortlog describe bisect
    ].freeze

    # Non-interactive Git CLI used by the embedded terminal. It deliberately
    # accepts Git commands only: a browser must never become an arbitrary shell
    # on the machine hosting the bridge.
    def terminal_command(command, studio_closed:)
      arguments = Shellwords.split(command.to_s.strip)
      arguments.shift if arguments.first == "git"
      raise GitWorkflowError, "enter a git command" if arguments.empty?
      raise GitWorkflowError, "git global options are not allowed in the embedded terminal" if
        arguments.first.start_with?("-")

      subcommand = arguments.first
      unless TERMINAL_SUBCOMMANDS.include?(subcommand)
        raise GitWorkflowError, "unsupported git command: #{subcommand}"
      end

      read_only = %w[status diff log show blame rev-parse reflog grep shortlog describe].include?(subcommand)
      read_only ||= subcommand == "remote" &&
        (arguments.length == 1 || arguments[1] == "-v" || arguments[1] == "show")
      mutating = !read_only
      ensure_studio_closed!(studio_closed) if mutating
      ensure_no_operation! if mutating && !%w[rebase merge cherry-pick revert bisect].include?(subcommand)

      output = error = nil
      result = nil
      Timeout.timeout(120) do
        output, error, result = Open3.capture3(
          {
            "GIT_TERMINAL_PROMPT" => "0",
            "GIT_EDITOR" => "true",
            "GIT_SEQUENCE_EDITOR" => "true"
          },
          "git", "-C", @root, *arguments
        )
      end
      combined = [output, error].compact.reject(&:empty?).join
      raise GitWorkflowError, combined.strip.empty? ? "git command failed" : combined.strip unless result.success?

      {
        "ok" => true,
        "command" => "git #{Shellwords.join(arguments)}",
        "output" => combined.strip,
        "exit_code" => result.exitstatus,
        **status
      }
    rescue ArgumentError => error
      raise GitWorkflowError, "invalid command line: #{error.message}"
    rescue Timeout::Error
      raise GitWorkflowError, "git command timed out after 120 seconds"
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

    # Stages the whole project directory then commits. Skips mx check so
    # work-in-progress can be committed; branch switches still guard a dirty tree.
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

    # Commits only what is already staged — no implicit git add. Enables
    # fine-grained staging via the git panel before committing.
    def commit_staged(message, studio_closed:)
      ensure_studio_closed!(studio_closed)
      ensure_no_operation!
      message = message.to_s.strip
      raise GitWorkflowError, "commit message cannot be empty" if message.empty?
      raise GitWorkflowError, "nothing staged to commit" if
        git!("diff", "--cached", "--name-only").strip.empty?

      git!("commit", "-m", message)
      status
    end

    # Commit log across all branches in topo order (newest first).
    # Returns an array of hashes with sha, short_sha, author, email, date,
    # subject, refs (typed array), parents (SHA array).
    def log(max: 200)
      fmt = "%H%x1f%h%x1f%an%x1f%ae%x1f%ai%x1f%P%x1f%D%x1f%s"
      raw = git!("log", "--all", "--topo-order",
                 "--pretty=format:#{fmt}",
                 "--max-count=#{max.to_i}")
      raw.each_line.filter_map do |line|
        fields = line.chomp.split("\x1f", 8)
        next if fields.length < 8

        sha, short_sha, author, email, date, parents_str, refs_str, subject = fields
        next if sha.to_s.strip.empty?

        {
          "sha"       => sha.strip,
          "short_sha" => short_sha.strip,
          "author"    => author.strip,
          "email"     => email.strip,
          "date"      => date.strip,
          "subject"   => subject.to_s.strip,
          "refs"      => parse_refs(refs_str.to_s.strip),
          "parents"   => parents_str.to_s.strip.split.reject(&:empty?)
        }
      end
    end

    # Per-file working-tree and index status (porcelain v1, NUL-terminated).
    def file_status
      raw = git!("status", "--porcelain=v1", "-z")
      files = []
      entries = raw.split("\x00")
      i = 0
      while i < entries.length
        entry = entries[i]
        unless entry.length >= 4
          i += 1
          next
        end
        xy            = entry[0..1]
        path          = entry[3..]
        renamed_from  = nil
        if xy[0] == "R" || xy[0] == "C"
          renamed_from = entries[i + 1].to_s
          i += 1
        end
        files << {
          "path"            => path.to_s,
          "xy"              => xy,
          "index_status"    => xy[0].to_s,
          "worktree_status" => xy[1].to_s,
          "renamed_from"    => renamed_from
        }
        i += 1
      end
      files
    end

    def stage(path)
      git!("add", "--", path)
      { "ok" => true }
    end

    def unstage(path)
      begin
        git!("reset", "HEAD", "--", path)
      rescue GitWorkflowError
        # HEAD doesn't exist yet (empty repo) — use rm --cached instead
        git!("rm", "--cached", "--", path)
      end
      { "ok" => true }
    end

    def discard(path)
      target = File.expand_path(path, @root)
      unless target.start_with?("#{@root}/")
        raise GitWorkflowError, "path is outside the Git repository: #{path}"
      end

      raw = git!("status", "--porcelain", "--", path).strip
      if raw.start_with?("??")
        FileUtils.rm_rf(target)
      else
        git!("checkout", "--", path)
      end
      { "ok" => true }
    end

    def push(remote: "origin", branch: nil)
      branch ||= current_branch
      output = git!("push", "--set-upstream", remote, branch)
      { "ok" => true, "output" => output.strip }
    end

    def add_remote(name, url)
      name = name.to_s.strip
      url = url.to_s.strip
      raise GitWorkflowError, "remote name cannot be empty" if name.empty?
      raise GitWorkflowError, "remote URL cannot be empty" if url.empty?
      raise GitWorkflowError, "invalid remote name: #{name}" unless name.match?(/\A[A-Za-z0-9._-]+\z/)

      git!("remote", "add", name, url)
      { "ok" => true, "name" => name, "url" => url }
    end

    def pull(studio_closed:)
      ensure_studio_closed!(studio_closed)
      ensure_no_operation!
      output = git!("pull", "--rebase")
      refresh_inventory! if @inventory_dir
      { "ok" => true, "output" => output.strip, **status }
    end

    def cherry_pick(sha, studio_closed:)
      ensure_studio_closed!(studio_closed)
      ensure_no_operation!
      output, error, result = Open3.capture3("git", "-C", @root, "cherry-pick", sha)
      raise GitWorkflowError, "cherry-pick failed:\n#{error}#{output}" unless result.success?

      refresh_inventory! if @inventory_dir
      { "ok" => true, "output" => output.strip, **status }
    end

    def revert_commit(sha, studio_closed:)
      ensure_studio_closed!(studio_closed)
      ensure_no_operation!
      output, error, result = Open3.capture3("git", "-C", @root, "revert", "--no-edit", sha)
      raise GitWorkflowError, "revert failed:\n#{error}#{output}" unless result.success?

      refresh_inventory! if @inventory_dir
      { "ok" => true, "output" => output.strip, **status }
    end

    def reset_to(sha, mode: "mixed", studio_closed:)
      ensure_studio_closed!(studio_closed)
      ensure_no_operation!
      raise GitWorkflowError, "invalid reset mode: #{mode}" unless
        %w[soft mixed hard].include?(mode.to_s)

      git!("reset", "--#{mode}", sha)
      refresh_inventory! if @inventory_dir && mode == "hard"
      { "ok" => true, **status }
    end

    def create_tag(name, sha: nil, message: nil)
      args = ["tag"]
      args.concat(["-a", name, "-m", message]) if message
      args << name unless message
      args << sha if sha
      git!(*args)
      { "ok" => true }
    end

    def delete_tag(name)
      git!("tag", "-d", name)
      { "ok" => true }
    end

    def delete_branch(name, force: false)
      raise GitWorkflowError, "cannot delete the current branch" if name == current_branch

      git!("branch", force ? "-D" : "-d", name)
      { "ok" => true }
    end

    private

    def parse_refs(refs_str)
      return [] if refs_str.to_s.strip.empty?

      refs_str.split(",").map(&:strip).reject(&:empty?).filter_map do |ref|
        if ref.start_with?("HEAD -> ")
          { "name" => ref.sub("HEAD -> ", ""), "type" => "head" }
        elsif ref == "HEAD"
          { "name" => "HEAD", "type" => "detached" }
        elsif ref.start_with?("tag: ")
          { "name" => ref.sub("tag: ", ""), "type" => "tag" }
        elsif ref.include?("/")
          { "name" => ref, "type" => "remote" }
        else
          { "name" => ref, "type" => "local" }
        end
      end
    end

    def project_pathspec
      relative = Pathname.new(@project_dir).relative_path_from(Pathname.new(@root)).to_s
      relative == "." ? "." : relative
    end

    def ensure_switch_ready!(branch, studio_closed:)
      ensure_studio_closed!(studio_closed)
      raise GitWorkflowError, "working tree is dirty; commit or stash changes first" unless clean?
      ensure_no_operation!
      validate_branch_name!(branch)
    end

    def validate_branch_name!(branch)
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

      _output, error, status = @runner.run("validate", @project_file)
      unless status.success?
        raise GitWorkflowError, "mxrb structural validation failed:\n#{error}"
      end
    end

    def refresh_inventory!
      metadata_file = File.join(@inventory_dir, "mendix-project.json")
      raise GitWorkflowError, "not an imported inventory: #{@inventory_dir}" unless File.file?(metadata_file)

      metadata = JSON.parse(File.read(metadata_file))
      unless File.realpath(metadata.fetch("source_project")) == File.realpath(@project_file)
        raise GitWorkflowError, "inventory belongs to a different Mendix project"
      end

      _tree, warnings = MxrbImporter.new(runner: @runner).import(@project_file, @inventory_dir)
      return if warnings.empty?

      raise GitWorkflowError, "inventory refresh had #{warnings.length} warnings"
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
