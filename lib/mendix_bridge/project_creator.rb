# frozen_string_literal: true

require "fileutils"
require "open3"
require "tempfile"

module MendixBridge
  class ProjectCreationError < StandardError; end

  class ProjectCreator
    Result = Data.define(:project_dir, :project_file, :model_file, :git_initialized)

    GITIGNORE = <<~IGNORE
      deployment/
      releases/
      testresults/
      *.mpr.bak
      *.mpr.backup
      .idea/
      .vscode/
    IGNORE

    def initialize(mxcli:)
      @mxcli = File.expand_path(mxcli)
    end

    def create(model, source_file:, output_dir:, version:, git: true)
      source_file = File.expand_path(source_file)
      output_dir = File.expand_path(output_dir)
      validate_inputs!(source_file, output_dir, version)

      run!(
        @mxcli,
        "new",
        model.name,
        "--version", version,
        "--output-dir", output_dir,
        "--skip-init",
        error_prefix: "mxcli could not create the blank project"
      )

      project_file = locate_project_file(output_dir)
      existing_modules = read_modules(project_file)
      mdl = MendixBridge.compile(
        model,
        format: :mdl,
        include_modules: true,
        skip_modules: existing_modules
      )
      apply_model!(mdl, project_file)
      check_project!(project_file, version)

      model_file = File.join(output_dir, "app.rb")
      FileUtils.cp(source_file, model_file)
      File.write(File.join(output_dir, ".mendix-version"), "#{version}\n")
      File.write(File.join(output_dir, ".gitignore"), GITIGNORE)
      initialize_git!(output_dir) if git

      Result.new(
        project_dir: output_dir,
        project_file:,
        model_file:,
        git_initialized: git
      )
    rescue ProjectCreationError
      raise
    rescue StandardError => error
      raise ProjectCreationError, error.message
    end

    private

    def validate_inputs!(source_file, output_dir, version)
      raise ProjectCreationError, "Ruby model does not exist: #{source_file}" unless
        File.file?(source_file)
      raise ProjectCreationError, "mxcli is not executable: #{@mxcli}" unless
        File.executable?(@mxcli)
      raise ProjectCreationError, "output directory already exists: #{output_dir}" if
        File.exist?(output_dir)
      raise ProjectCreationError, "invalid Mendix version: #{version}" unless
        version.to_s.match?(/\A\d+\.\d+\.\d+\z/)
    end

    def locate_project_file(output_dir)
      projects = Dir[File.join(output_dir, "*.mpr")]
      unless projects.length == 1
        raise ProjectCreationError,
          "expected one .mpr in #{output_dir}, found #{projects.length}"
      end

      projects.first
    end

    def read_modules(project_file)
      output = run!(
        @mxcli,
        "-p", project_file,
        "-c", "SHOW MODULES;",
        error_prefix: "could not inspect modules in the blank project"
      )
      output.scan(/^\|\s+([A-Za-z_][A-Za-z0-9_]*)\s+\|/).flatten
        .reject { |name| name == "Module" }
    end

    def apply_model!(mdl, project_file)
      Tempfile.create(["mendix-ruby-new-", ".mdl"]) do |file|
        file.write(mdl)
        file.flush
        run!(
          @mxcli,
          "check", file.path,
          error_prefix: "generated project MDL is invalid"
        )
        run!(
          @mxcli,
          "exec", file.path,
          "-p", project_file,
          error_prefix: "mxcli could not apply the Ruby model"
        )
      end
    end

    def check_project!(project_file, version)
      mx = File.join(
        Dir.home,
        ".mxcli",
        "mxbuild",
        version,
        "modeler",
        "mx"
      )
      raise ProjectCreationError, "Mendix mx #{version} is not installed: #{mx}" unless
        File.executable?(mx)

      run!(
        mx,
        "check",
        project_file,
        chdir: File.dirname(project_file),
        error_prefix: "official Mendix consistency check failed"
      )
    end

    def initialize_git!(output_dir)
      run!(
        "git",
        "init",
        "-b", "main",
        chdir: output_dir,
        error_prefix: "could not initialize Git"
      )
      run!(
        "git",
        "add",
        ".",
        chdir: output_dir,
        error_prefix: "could not stage the initial project"
      )
      run!(
        "git",
        "commit",
        "-m", "Initial Setup",
        chdir: output_dir,
        error_prefix: "could not create the initial Git commit"
      )
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
      raise ProjectCreationError, "#{error_prefix}: #{detail}"
    end
  end
end
