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

    def initialize(runner: MxrbRunner.new)
      @runner = runner
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
      raise MigrationError, "mxrb is not available" unless @runner.executable?
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
          @runner.binary,
          "rename",
          project_file,
          operation.name,
          options,
          error_prefix: "rename preview failed for #{operation.name}"
        )
      end

      dsl = Migration::Generator.mxrb_dsl(plan)
      return if dsl.nil? || dsl.empty?

      with_dsl(dsl, project_file) do |dsl_path, out_path|
        run!(
          @runner.binary,
          "generate", dsl_path, out_path,
          error_prefix: "migration DSL is invalid"
        )
        FileUtils.rm_f(out_path)
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
          @runner.binary,
          "rename",
          project_file,
          operation.name,
          operation.options.fetch("to"),
          "--apply",
          error_prefix: "could not rename #{operation.name}"
        )
      end
    end

    def apply_mdl!(plan, project_file)
      dsl = Migration::Generator.mxrb_dsl(plan)
      return if dsl.nil? || dsl.empty?

      with_dsl(dsl, project_file) do |dsl_path, _out_path|
        run!(
          @runner.binary,
          "generate", dsl_path, project_file,
          error_prefix: "could not apply migration"
        )
      end
    end

    def check_project!(project_file)
      run!(
        @runner.binary,
        "validate", project_file,
        error_prefix: "mxrb structural validation failed"
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

    # Writes DSL to a temp file and yields [dsl_path, tmp_output_mpr_path] to
    # the block. The caller decides whether to apply to the real project.mpr or
    # a temp copy (for dry-run / validation).
    def with_dsl(dsl, project_file)
      Tempfile.create(["mendix-ruby-migration-", ".rb"]) do |dsl_file|
        dsl_file.write(dsl)
        dsl_file.flush
        tmp_out = "#{project_file}.mxrb-tmp-#{SecureRandom.hex(4)}.mpr"
        FileUtils.cp(project_file, tmp_out)
        begin
          yield dsl_file.path, tmp_out
        ensure
          FileUtils.rm_f(tmp_out)
        end
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
