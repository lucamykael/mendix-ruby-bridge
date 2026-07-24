# frozen_string_literal: true

require "fileutils"
require "open3"
require "time"

module MendixBridge
  class ImportError < StandardError; end

  class Importer
    SNAPSHOT_FILE = "inventory/project-tree.json"
    ELEMENT_DETAILS_FILE = "inventory/element-details.json"
    METADATA_FILE = "mendix-project.json"

    def initialize(mxcli:)
      @mxcli = File.expand_path(mxcli)
    end

    def import(project_file, output_dir)
      project_file = File.expand_path(project_file)
      output_dir = File.expand_path(output_dir)

      raise ImportError, "Mendix project does not exist: #{project_file}" unless File.file?(project_file)
      raise ImportError, "mxcli is not executable: #{@mxcli}" unless File.executable?(@mxcli)

      stdout, stderr, status = Open3.capture3(
        @mxcli, "--json", "-p", project_file, "project-tree"
      )
      unless status.success?
        raise ImportError, "mxcli could not read the project: #{stderr.strip}"
      end

      inventory = Inventory.from_json(stdout)
      element_details, warnings = describe_elements(project_file, inventory)
      inventory = Inventory.from_json(stdout, details: element_details)
      write_project(output_dir, project_file, inventory)
      [inventory, warnings]
    rescue JSON::ParserError => error
      raise ImportError, "mxcli returned invalid project-tree JSON: #{error.message}"
    end

    private

    def write_project(output_dir, project_file, inventory)
      FileUtils.mkdir_p(File.join(output_dir, "inventory"))
      FileUtils.rm_f(File.join(output_dir, "inventory", "domain-details.json"))

      File.write(
        File.join(output_dir, SNAPSHOT_FILE),
        "#{JSON.pretty_generate(inventory.tree)}\n"
      )
      File.write(
        File.join(output_dir, ELEMENT_DETAILS_FILE),
        "#{JSON.pretty_generate(element_details(inventory))}\n"
      )
      File.write(
        File.join(output_dir, METADATA_FILE),
        "#{JSON.pretty_generate(metadata(project_file, inventory))}\n"
      )
      write_once(File.join(output_dir, "Gemfile"), gemfile)
      write_once(File.join(output_dir, "Mendixfile.rb"), mendixfile)
      write_once(File.join(output_dir, "README.md"), readme(project_file))
      write_generated_modules(output_dir, inventory)
      write_generated_microflows(output_dir, inventory)
      write_generated_nanoflows(output_dir, inventory)
      write_generated_enumerations(output_dir, inventory)
      write_generated_pages(output_dir, inventory)
      write_generated_project_documents(output_dir, inventory)
      write_generated_security(output_dir, inventory)
    end

    def metadata(project_file, inventory)
      {
        schema_version: 1,
        source_project: project_file,
        imported_at: Time.now.iso8601,
        snapshot: SNAPSHOT_FILE,
        element_count: inventory.elements.length,
        types: inventory.types
      }
    end

    def write_once(path, content)
      File.write(path, content) unless File.exist?(path)
    end

    def describe_elements(project_file, inventory)
      details = {}
      warnings = []

      inventory.elements
        .select do |element|
          %w[
            entity association enumeration microflow nanoflow page
            constant javaaction layout snippet importmapping exportmapping navprofile
            projectsecurity modulerole userrole
          ].include?(element.type)
        end
        .each do |element|
          describe_type, describe_name = describe_target(element)
          stdout, stderr, status = Open3.capture3(
            @mxcli,
            "--json",
            "-p", project_file,
            "describe", describe_type, describe_name
          )

          unless status.success?
            warnings << "#{element.qualified_name}: #{stderr.strip}"
            next
          end

          description = JSON.parse(stdout)
          details[element.qualified_name] =
            if %w[microflow nanoflow].include?(element.type)
              MicroflowParser.parse(description)
            elsif element.type == "enumeration"
              EnumerationParser.parse(description)
            elsif %w[
              constant javaaction layout snippet importmapping exportmapping navprofile
            ].include?(element.type)
              DocumentParser.parse(element.type, description)
            elsif element.type == "page"
              PageParser.parse(description)
            elsif %w[projectsecurity modulerole userrole].include?(element.type)
              SecurityParser.parse(element.type, description)
            else
              DomainParser.parse(description)
            end
        rescue JSON::ParserError => error
          warnings << "#{element.qualified_name}: invalid JSON (#{error.message})"
        end

      [details, warnings]
    end

    def describe_target(element)
      case element.type
      when "importmapping", "exportmapping"
        [element.type, element.label]
      when "navprofile"
        ["navigation", element.qualified_name]
      else
        [element.type, element.qualified_name]
      end
    end

    def element_details(inventory)
      inventory.elements.each_with_object({}) do |element, result|
        if element.qualified_name && element.details
          result[element.qualified_name] = element.details
        end
      end
    end

    def write_generated_modules(output_dir, inventory)
      generated_dir = File.join(output_dir, "generated", "modules")
      FileUtils.mkdir_p(generated_dir)
      FileUtils.rm_f(Dir[File.join(generated_dir, "*.rb")])

      RubyInventoryGenerator.generate(inventory).each do |module_name, domain|
        path = File.join(
          generated_dir,
          "#{RubyInventoryGenerator.file_name(module_name)}.rb"
        )
        File.write(path, RubyInventoryGenerator.ruby_source(module_name, domain))
      end
    end

    def write_generated_microflows(output_dir, inventory)
      generated_dir = File.join(output_dir, "generated", "microflows")
      FileUtils.mkdir_p(generated_dir)
      FileUtils.rm_f(Dir[File.join(generated_dir, "*.rb")])

      inventory.modules.each do |app_module|
        module_name = app_module.qualified_name
        microflows = inventory.elements
          .select do |element|
            element.type == "microflow" &&
              element.qualified_name&.start_with?("#{module_name}.")
          end
          .map do |element|
            {
              "name" => element.label,
              "qualified_name" => element.qualified_name,
              "details" => element.details
            }
          end
        next if microflows.empty?

        path = File.join(
          generated_dir,
          "#{RubyInventoryGenerator.file_name(module_name)}.rb"
        )
        File.write(
          path,
          RubyInventoryGenerator.ruby_source(
            "#{module_name}Microflows",
            "microflows" => microflows
          )
        )
      end
    end

    def write_generated_nanoflows(output_dir, inventory)
      write_generated_documents(
        output_dir,
        inventory,
        type: "nanoflow",
        directory: "nanoflows"
      )
    end

    def write_generated_enumerations(output_dir, inventory)
      write_generated_documents(
        output_dir,
        inventory,
        type: "enumeration",
        directory: "enumerations"
      )
    end

    def write_generated_pages(output_dir, inventory)
      write_generated_documents(output_dir, inventory, type: "page", directory: "pages")
    end

    def write_generated_project_documents(output_dir, inventory)
      {
        "constant" => "constants",
        "javaaction" => "java_actions",
        "layout" => "layouts",
        "snippet" => "snippets",
        "importmapping" => "import_mappings",
        "exportmapping" => "export_mappings"
      }.each do |type, directory|
        write_generated_documents(output_dir, inventory, type:, directory:)
      end

      write_generated_navigation(output_dir, inventory)
    end

    def write_generated_navigation(output_dir, inventory)
      generated_dir = File.join(output_dir, "generated", "navigation")
      FileUtils.mkdir_p(generated_dir)
      FileUtils.rm_f(Dir[File.join(generated_dir, "*.rb")])

      profiles = inventory.of_type("navprofile").map do |element|
        {
          "name" => element.label,
          "qualified_name" => element.qualified_name,
          "details" => element.details
        }
      end
      return if profiles.empty?

      File.write(
        File.join(generated_dir, "project.rb"),
        RubyInventoryGenerator.ruby_source(
          "Navigation",
          "navigation_profiles" => profiles
        )
      )
    end

    def write_generated_documents(output_dir, inventory, type:, directory:)
      generated_dir = File.join(output_dir, "generated", directory)
      FileUtils.mkdir_p(generated_dir)
      FileUtils.rm_f(Dir[File.join(generated_dir, "*.rb")])

      inventory.modules.each do |app_module|
        module_name = app_module.qualified_name
        documents = inventory.elements
          .select do |element|
            element.type == type &&
              element.qualified_name&.start_with?("#{module_name}.")
          end
          .map do |element|
            {
              "name" => element.label,
              "qualified_name" => element.qualified_name,
              "details" => element.details
            }
          end
        next if documents.empty?

        path = File.join(
          generated_dir,
          "#{RubyInventoryGenerator.file_name(module_name)}.rb"
        )
        File.write(
          path,
          RubyInventoryGenerator.ruby_source(
            "#{module_name}#{type.capitalize}s",
            "#{type}s" => documents
          )
        )
      end
    end

    def write_generated_security(output_dir, inventory)
      generated_dir = File.join(output_dir, "generated", "security")
      FileUtils.mkdir_p(generated_dir)
      FileUtils.rm_f(Dir[File.join(generated_dir, "*.rb")])

      security_elements = inventory.elements
        .select { |element| %w[projectsecurity modulerole userrole].include?(element.type) }
        .map do |element|
          {
            "name" => element.qualified_name || element.label,
            "type" => element.type,
            "details" => element.details
          }
        end
      entity_access = inventory.of_type("entity").filter_map do |entity|
        rules = entity.details&.fetch("access_rules", [])
        next if rules.empty?

        { "entity" => entity.qualified_name, "rules" => rules }
      end

      source = RubyInventoryGenerator.ruby_source(
        "Security",
        "security_elements" => security_elements,
        "entity_access" => entity_access
      )
      File.write(File.join(generated_dir, "project.rb"), source)
    end

    def mendixfile
      <<~RUBY
        # frozen_string_literal: true

        require "mendix_bridge"

        MENDIX_PROJECT = MendixBridge::Inventory.load(
          File.expand_path("inventory/project-tree.json", __dir__)
        )
      RUBY
    end

    def gemfile
      bridge_dir = File.dirname(File.dirname(@mxcli))

      <<~RUBY
        source "https://rubygems.org"

        gem "mendix-ruby-bridge", path: #{bridge_dir.inspect}
      RUBY
    end

    def readme(project_file)
      <<~MARKDOWN
        # Imported Mendix project

        Read-only Ruby inventory imported from:

        `#{project_file}`

        Load it from Ruby:

        ```ruby
        require_relative "Mendixfile"

        project = MENDIX_PROJECT
        project.modules
        project.of_type("microflow")
        project.search("Customer")
        project.find("MyFirstModule.Customer")
        ```

        Generated domain-model files are under `generated/modules/`; generated
        microflow files are under `generated/microflows/`; nanoflows are under
        `generated/nanoflows/`; enumerations are under
        `generated/enumerations/`; generated pages are under `generated/pages/`;
        the consolidated security view is under `generated/security/`. Every
        interpreted element retains its original MDL plus normalized details.

        Explore interactively:

        ```sh
        bundle exec irb -r ./Mendixfile
        ```

        Refresh the snapshot by running `mendix-ruby import` again with
        `--force`. Importing and querying do not modify the `.mpr` project.
      MARKDOWN
    end
  end
end
