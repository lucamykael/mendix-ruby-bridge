# frozen_string_literal: true

require "fileutils"
require "json"
require "time"

module MendixBridge
  class MxrbImportError < StandardError; end

  # Replaces the old mxcli-based Importer.
  #
  # Single call to `mxrb export` does what the old importer accomplished with
  # dozens of parallel `mxcli describe` processes: it exports the full project
  # as a structured Ruby DSL directory and also yields the structural tree used
  # to build the inventory JSON expected by the frontend.
  class MxrbImporter
    METADATA_FILE   = "mendix-project.json"
    TREE_FILE       = File.join("inventory", "project-tree.json")
    DETAILS_FILE    = File.join("inventory", "element-details.json")
    DEPS_FILE       = File.join("inventory", "dependencies.json")

    def initialize(runner: MxrbRunner.new)
      @runner = runner
    end

    # Exports the MPR to output_dir and writes the JSON inventory sidecars.
    # Returns a [summary, warnings] pair compatible with the old Importer API.
    def import(project_file, output_dir)
      project_file = File.expand_path(project_file)
      output_dir   = File.expand_path(output_dir)

      raise MxrbImportError, "project does not exist: #{project_file}" unless File.file?(project_file)
      raise MxrbImportError, "mxrb is not available" unless @runner.executable?

      FileUtils.mkdir_p(File.join(output_dir, "inventory"))

      export!(project_file, output_dir)
      tree, warnings = build_tree(project_file)
      details        = build_details(project_file, tree)

      write_json(File.join(output_dir, TREE_FILE),    tree)
      write_json(File.join(output_dir, DETAILS_FILE), details)
      write_json(File.join(output_dir, DEPS_FILE),    build_deps(tree))
      write_json(File.join(output_dir, METADATA_FILE), build_metadata(project_file, tree))

      [tree, warnings]
    end

    private

    def export!(project_file, output_dir)
      @runner.run!("export", project_file, output_dir,
                   error_prefix: "mxrb export failed")
    rescue MxrbError => e
      raise MxrbImportError, e.message
    end

    # Parses `mxrb tree <mpr> [module]` for every module and builds the flat
    # element list used as project-tree.json.
    def build_tree(project_file)
      warnings = []
      elements = []

      modules_out, = @runner.run("modules", project_file)
      module_names = modules_out.scan(/name="([^"]+)"/).flatten

      module_names.each do |mod_name|
        tree_out, stderr, status = @runner.run("tree", project_file, mod_name)
        unless status.success?
          warnings << "tree for #{mod_name}: #{stderr.strip}"
          next
        end
        parse_tree_output(mod_name, tree_out, elements)
      end

      [{ "elements" => elements }, warnings]
    end

    # Builds element-details.json by calling `mxrb describe` for each element
    # that mxrb can describe meaningfully (entities, associations, microflows, pages).
    def build_details(project_file, tree)
      details = {}
      describable_types = %w[entity association microflow nanoflow page enumeration]

      Array(tree["elements"])
        .select { |e| describable_types.include?(e["type"]) }
        .each do |element|
          out, _err, status = @runner.run("describe", project_file, element["qualified_name"])
          details[element["qualified_name"]] = parse_describe_output(out) if status.success?
        end

      details
    end

    def build_deps(tree)
      { "schema_version" => 1, "generated_at" => Time.now.iso8601,
        "element_count" => Array(tree["elements"]).length }
    end

    def build_metadata(project_file, tree)
      {
        "schema_version"  => 2,
        "source_project"  => project_file,
        "imported_at"     => Time.now.iso8601,
        "importer"        => "mxrb",
        "element_count"   => Array(tree["elements"]).length,
        "snapshot"        => TREE_FILE
      }
    end

    # Parses the indented-text output of `mxrb tree <mpr> <module>`:
    #
    #   MyFirstModule
    #     association
    #       MyFirstModule.Order_Customer
    #     entity
    #       MyFirstModule.Customer
    #     microflow
    #       MyFirstModule.MyFirstLogic
    #
    # and appends hashes to `elements`.
    def parse_tree_output(module_name, text, elements)
      current_type = nil
      text.each_line do |line|
        stripped = line.strip
        next if stripped.empty? || stripped == module_name

        # Lines with exactly 2 leading spaces are type headers
        if line =~ /\A  (\w+)\z/
          current_type = Regexp.last_match(1)
        elsif line =~ /\A    (.+)\z/ && current_type
          qn = Regexp.last_match(1).strip
          label = qn.split(".").last
          elements << {
            "type"           => current_type,
            "qualified_name" => qn,
            "label"          => label,
            "module"         => module_name
          }
        end
      end
    end

    # Parses the text output of `mxrb describe <mpr> <name>`:
    #
    #   MyFirstModule.Customer	entity
    #   Incoming:
    #   Outgoing:
    #     MyFirstModule.Customer.Name	uses_attribute
    #
    def parse_describe_output(text)
      lines = text.lines.map(&:strip).reject(&:empty?)
      return {} if lines.empty?

      header    = lines.first.split("\t")
      qn        = header[0].strip
      type      = header[1]&.strip

      incoming = []
      outgoing = []
      section  = nil

      lines.drop(1).each do |line|
        if line == "Incoming:"
          section = :incoming
        elsif line == "Outgoing:"
          section = :outgoing
        elsif section
          parts = line.split("\t")
          ref   = { "name" => parts[0].strip, "rel" => parts[1]&.strip }
          (section == :incoming ? incoming : outgoing) << ref
        end
      end

      { "qualified_name" => qn, "type" => type,
        "incoming" => incoming, "outgoing" => outgoing }
    end

    def write_json(path, data)
      FileUtils.mkdir_p(File.dirname(path))
      File.write(path, "#{JSON.pretty_generate(data)}\n")
    end
  end
end
