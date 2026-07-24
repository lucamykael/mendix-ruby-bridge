# frozen_string_literal: true

require "fileutils"
require "json"
require "open3"
require "securerandom"
require "tempfile"
require "time"

module MendixBridge
  class MigrationError < StandardError; end

  class MigrationExecutor
    Result = Data.define(:backup_dir, :operations)

    def initialize(mxcli:)
      @mxcli = File.expand_path(mxcli)
    end

    def apply(plan, project_file:, confirmation:, studio_closed:)
      project_file = File.expand_path(project_file)
      validate!(plan, project_file, confirmation, studio_closed)
      project_dir = File.dirname(project_file)
      ensure_clean_git!(project_dir)
      validate_operations!(plan, project_file)
      backup_dir = create_backup(plan, project_file)

      begin
        apply_renames!(plan, project_file)
        apply_mdl!(plan, project_file)
        check_project!(project_file)
      rescue StandardError => error
        begin
          restore_backup!(backup_dir, project_file)
          check_project!(project_file)
        rescue StandardError => restore_error
          raise MigrationError,
            "migration failed and automatic restore also failed; " \
            "backup is #{backup_dir}: #{restore_error.message}"
        end
        raise MigrationError,
          "migration failed and backup was restored: #{error.message}"
      end

      Result.new(backup_dir:, operations: plan.operations.length)
    end

    def restore(backup_dir, project_file:, confirmation:, studio_closed:)
      backup_dir = File.expand_path(backup_dir)
      project_file = File.expand_path(project_file)
      manifest = read_manifest(backup_dir)
      expected = File.basename(backup_dir)
      raise MigrationError, "confirmation must exactly match #{expected}" unless
        confirmation == expected
      raise MigrationError, "--studio-closed is required" unless studio_closed
      unless File.expand_path(manifest.fetch("project_file")) == project_file
        raise MigrationError, "backup belongs to another Mendix project"
      end

      restore_backup!(backup_dir, project_file)
      check_project!(project_file)
      true
    end

    private

    def validate!(plan, project_file, confirmation, studio_closed)
      raise MigrationError, "Mendix project does not exist: #{project_file}" unless
        File.file?(project_file)
      raise MigrationError, "mxcli is not executable: #{@mxcli}" unless
        File.executable?(@mxcli)
      raise MigrationError, "--studio-closed is required" unless studio_closed
      unless confirmation == plan.name
        raise MigrationError, "confirmation must exactly match migration name #{plan.name}"
      end
    end

    def ensure_clean_git!(project_dir)
      root = run!(
        "git", "-C", project_dir, "rev-parse", "--show-toplevel",
        error_prefix: "Mendix project must be inside a Git repository"
      ).strip
      status = run!(
        "git", "-C", root, "status", "--porcelain",
        error_prefix: "could not inspect Git status"
      )
      raise MigrationError, "target repository has uncommitted changes" unless status.empty?
    end

    def validate_operations!(plan, project_file)
      Migration::Generator.rename_operations(plan).each do |operation|
        options = operation.options.fetch("to")
        run!(
          @mxcli,
          "rename",
          "-p", project_file,
          operation.type,
          operation.name,
          options,
          "--dry-run",
          error_prefix: "rename preview failed for #{operation.name}"
        )
      end

      mdl = Migration::Generator.mdl(plan)
      return if mdl.empty?

      with_mdl(mdl) do |path|
        run!(
          @mxcli,
          "check", path,
          error_prefix: "migration MDL is invalid"
        )
      end
    end

    def create_backup(plan, project_file)
      project_dir = File.dirname(project_file)
      id = "#{Time.now.utc.strftime('%Y%m%dT%H%M%SZ')}-" \
        "#{safe_name(plan.name)}-#{SecureRandom.hex(3)}"
      backup_root = run!(
        "git",
        "-C", project_dir,
        "rev-parse",
        "--path-format=absolute",
        "--git-path", "mendix-ruby-backups",
        error_prefix: "could not locate Git backup storage"
      ).strip
      backup_dir = File.join(backup_root, id)
      FileUtils.mkdir_p(backup_dir)
      FileUtils.cp(project_file, File.join(backup_dir, File.basename(project_file)))
      contents = File.join(project_dir, "mprcontents")
      FileUtils.cp_r(contents, File.join(backup_dir, "mprcontents")) if Dir.exist?(contents)
      File.write(
        File.join(backup_dir, "manifest.json"),
        "#{JSON.pretty_generate(
          "migration" => plan.name,
          "project_file" => project_file,
          "created_at" => Time.now.utc.iso8601,
          "operations" => plan.operations.map(&:to_h)
        )}\n"
      )
      backup_dir
    end

    def apply_renames!(plan, project_file)
      Migration::Generator.rename_operations(plan).each do |operation|
        run!(
          @mxcli,
          "rename",
          "-p", project_file,
          operation.type,
          operation.name,
          operation.options.fetch("to"),
          error_prefix: "could not rename #{operation.name}"
        )
      end
    end

    def apply_mdl!(plan, project_file)
      mdl = Migration::Generator.mdl(plan)
      return if mdl.empty?

      with_mdl(mdl) do |path|
        run!(
          @mxcli,
          "exec", path,
          "-p", project_file,
          error_prefix: "could not apply migration MDL"
        )
      end
    end

    def check_project!(project_file)
      version_file = File.join(File.dirname(project_file), ".mendix-version")
      raise MigrationError, "missing #{version_file}" unless File.file?(version_file)

      version = File.read(version_file).strip
      mx = File.join(Dir.home, ".mxcli", "mxbuild", version, "modeler", "mx")
      raise MigrationError, "Mendix mx #{version} is not installed" unless File.executable?(mx)

      run!(
        mx,
        "check",
        project_file,
        chdir: File.dirname(project_file),
        error_prefix: "official Mendix consistency check failed"
      )
    end

    def restore_backup!(backup_dir, project_file)
      manifest = read_manifest(backup_dir)
      source_project = File.join(backup_dir, File.basename(manifest.fetch("project_file")))
      FileUtils.cp(source_project, project_file)

      project_contents = File.join(File.dirname(project_file), "mprcontents")
      backup_contents = File.join(backup_dir, "mprcontents")
      FileUtils.rm_rf(project_contents)
      FileUtils.cp_r(backup_contents, project_contents) if Dir.exist?(backup_contents)
    end

    def read_manifest(backup_dir)
      path = File.join(backup_dir, "manifest.json")
      raise MigrationError, "invalid migration backup: #{backup_dir}" unless File.file?(path)

      JSON.parse(File.read(path))
    end

    def safe_name(name)
      name.downcase.gsub(/[^a-z0-9]+/, "-").gsub(/\A-|-\z/, "")
    end

    def with_mdl(mdl)
      Tempfile.create(["mendix-ruby-migration-", ".mdl"]) do |file|
        file.write(mdl)
        file.flush
        yield file.path
      end
    end

    def run!(*command, chdir: nil, error_prefix:)
      stdout, stderr, status = if chdir
        Open3.capture3(*command, chdir:)
      else
        Open3.capture3(*command)
      end
      return stdout if status.success?

      detail = stderr.strip
      detail = stdout.strip if detail.empty?
      raise MigrationError, "#{error_prefix}: #{detail}"
    end
  end
end
