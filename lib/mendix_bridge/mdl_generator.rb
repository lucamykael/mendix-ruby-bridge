# frozen_string_literal: true

module MendixBridge
  class MDLGenerator
    TYPE_NAMES = {
      "autonumber" => "AutoNumber",
      "binary" => "Binary",
      "boolean" => "Boolean",
      "datetime" => "DateTime",
      "decimal" => "Decimal",
      "hash_string" => "HashedString",
      "integer" => "Integer",
      "long" => "Long",
      "string" => "String"
    }.freeze

    def self.generate(
      model,
      skip_associations: [],
      skip_module_roles: [],
      skip_user_roles: [],
      include_modules: false,
      skip_modules: []
    )
      new(
        model,
        skip_associations:,
        skip_module_roles:,
        skip_user_roles:,
        include_modules:,
        skip_modules:
      ).generate
    end

    def self.microflow_statement(app_module, microflow)
      new(nil).send(:microflow_statement, app_module, microflow)
    end

    def self.page_statement(app_module, page)
      new(nil).send(:page_statement, app_module, page)
    end

    def initialize(
      model,
      skip_associations: [],
      skip_module_roles: [],
      skip_user_roles: [],
      include_modules: false,
      skip_modules: []
    )
      @model = model
      @skip_associations = skip_associations
      @skip_module_roles = skip_module_roles
      @skip_user_roles = skip_user_roles
      @include_modules = include_modules
      @skip_modules = skip_modules
    end

    def generate
      statements = []
      if @include_modules
        statements.concat(@model.modules.filter_map do |app_module|
          next if @skip_modules.include?(app_module.name)

          "CREATE MODULE #{identifier(app_module.name)};"
        end)
      end
      statements.concat(@model.modules.flat_map do |app_module|
        enumerations = app_module.enumerations.map do |enumeration|
          enumeration_statement(app_module, enumeration)
        end
        microflows = app_module.microflows.map do |microflow|
          microflow_statement(app_module, microflow)
        end
        pages = app_module.pages.map { |page| page_statement(app_module, page) }
        module_roles = app_module.module_roles.filter_map do |role|
          name = "#{app_module.name}.#{role.name}"
          module_role_statement(app_module, role) unless @skip_module_roles.include?(name)
        end
        entities = app_module.entities.map { |entity| entity_statement(app_module, entity) }
        associations = app_module.entities.flat_map do |entity|
          entity.associations.map do |association|
            next if @skip_associations.include?(
              "#{app_module.name}.#{association.name}"
            )

            association_statement(app_module, entity, association)
          end.compact
        end

        module_roles + enumerations + entities + associations + microflows + pages
      end)

      statements.concat(user_role_statements)
      statements.concat(project_security_statements)
      statements.concat(navigation_statements)
      statements.join("\n\n") << "\n"
    end

    private

    def enumeration_statement(app_module, enumeration)
      values = enumeration.values.map do |value|
        "  #{identifier(value.name)} '#{escape_string(value.caption)}'"
      end
      folder = if enumeration.folder
        " FOLDER '#{escape_string(enumeration.folder)}'"
      else
        ""
      end

      "CREATE OR MODIFY ENUMERATION #{qualified(app_module.name, enumeration.name)} (\n" \
        "#{values.join(",\n")}\n" \
        ")#{folder};"
    end

    def microflow_statement(app_module, microflow)
      name = qualified(app_module.name, microflow.name)
      parameters = microflow.parameters.map do |parameter|
        "  $#{identifier(parameter.name)}: #{qualified_or_scalar(parameter.type)}"
      end
      returns = microflow.return_type ? "\nRETURNS #{qualified_or_scalar(microflow.return_type)}" : ""
      folder = microflow.folder ? "\nFOLDER '#{escape_string(microflow.folder)}'" : ""
      body = microflow.body.lines.map { |line| "  #{line.rstrip}" }.join("\n")
      grants = microflow.execute_roles.map do |role|
        "GRANT EXECUTE ON MICROFLOW #{name} TO #{qualified_reference(role)};"
      end

      statement = "CREATE OR MODIFY MICROFLOW #{name} (\n" \
        "#{parameters.join(",\n")}\n" \
        ")#{returns}#{folder}\n" \
        "BEGIN\n#{body}\nEND;"
      grants.empty? ? statement : "#{statement}\n\n#{grants.join("\n")}"
    end

    def page_statement(app_module, page)
      name = qualified(app_module.name, page.name)
      settings = [
        "Title: '#{escape_string(page.title)}'",
        "Layout: #{qualified_reference(page.layout)}"
      ]
      settings << "Folder: '#{escape_string(page.folder)}'" if page.folder
      unless page.parameters.empty?
        parameters = page.parameters.map do |parameter|
          "$#{identifier(parameter.name)}: #{qualified_reference(parameter.type)}"
        end
        settings << "Params: { #{parameters.join(', ')} }"
      end
      content = page.content.lines.map { |line| "  #{line.rstrip}" }.join("\n")
      grants = page.view_roles.map do |role|
        "GRANT VIEW ON PAGE #{name} TO #{qualified_reference(role)};"
      end

      statement = "CREATE OR MODIFY PAGE #{name} (\n" \
        "  #{settings.join(",\n  ")}\n" \
        ") {\n#{content}\n}"
      grants.empty? ? statement : "#{statement}\n\n#{grants.join("\n")}"
    end

    def module_role_statement(app_module, role)
      statement = "CREATE MODULE ROLE #{qualified(app_module.name, role.name)}"
      if role.description
        statement << " DESCRIPTION '#{escape_string(role.description)}'"
      end
      "#{statement};"
    end

    def user_role_statements
      @model.user_roles.filter_map do |role|
        next if @skip_user_roles.include?(role.name)

        management = role.manage_all_roles ? " MANAGE ALL ROLES" : ""
        module_roles = role.module_roles.map { |name| qualified_reference(name) }
        "CREATE USER ROLE #{identifier(role.name)} " \
          "(#{module_roles.join(', ')})#{management};"
      end
    end

    def project_security_statements
      security = @model.project_security
      return [] unless security

      [
        "ALTER PROJECT SECURITY LEVEL #{security.level.upcase};",
        "ALTER PROJECT SECURITY DEMO USERS #{security.demo_users ? 'ON' : 'OFF'};"
      ]
    end

    def navigation_statements
      @model.navigation_profiles.map do |profile|
        lines = [
          "CREATE OR REPLACE NAVIGATION #{identifier(profile.name)}",
          "  HOME PAGE #{qualified_reference(profile.home_page)}"
        ]
        profile.role_home_pages.each do |entry|
          lines << "  HOME PAGE #{qualified_reference(entry.page)} " \
            "FOR #{qualified_reference(entry.role)}"
        end
        if profile.login_page
          lines << "  LOGIN PAGE #{qualified_reference(profile.login_page)}"
        end
        if profile.not_found_page
          lines << "  NOT FOUND PAGE #{qualified_reference(profile.not_found_page)}"
        end
        unless profile.items.empty?
          lines << "  MENU ("
          profile.items.each do |item|
            lines.concat(navigation_item_lines(item, 4))
          end
          lines << "  )"
        end
        "#{lines.join("\n")};"
      end
    end

    def navigation_item_lines(item, indentation)
      prefix = " " * indentation
      if item.is_a?(Model::NavigationMenu)
        lines = ["#{prefix}MENU '#{escape_string(item.caption)}' ("]
        item.items.each do |child|
          lines.concat(navigation_item_lines(child, indentation + 2))
        end
        lines << "#{prefix});"
        lines
      else
        [
          "#{prefix}MENU ITEM '#{escape_string(item.caption)}' " \
          "#{item.action.upcase} #{qualified_reference(item.target)};"
        ]
      end
    end

    def entity_statement(app_module, entity)
      persistence = entity.persistable ? "PERSISTENT" : "NON-PERSISTENT"
      qualified_name = qualified(app_module.name, entity.name)

      attributes = entity.attributes.map do |attribute|
        "  #{identifier(attribute.name)}: #{attribute_type(attribute)}" \
          "#{constraints(attribute)}"
      end

      statement = "CREATE OR MODIFY #{persistence} ENTITY #{qualified_name} (\n" \
        "#{attributes.join(",\n")}\n" \
        ");"
      grants = entity.access_rules.map do |rule|
        entity_access_statement(qualified_name, rule)
      end
      grants.empty? ? statement : "#{statement}\n\n#{grants.join("\n")}"
    end

    def entity_access_statement(entity_name, rule)
      permissions = []
      permissions << "CREATE" if rule.create
      permissions << "DELETE" if rule.delete
      permissions << "READ #{access_attribute_list(rule.read)}" unless rule.read.empty?
      permissions << "WRITE #{access_attribute_list(rule.write)}" unless rule.write.empty?
      raise ValidationError, "entity access rule requires at least one permission" if permissions.empty?

      xpath = rule.xpath ? " WHERE '#{escape_string(rule.xpath)}'" : ""
      "GRANT #{qualified_reference(rule.role)} ON #{entity_name} " \
        "(#{permissions.join(', ')})#{xpath};"
    end

    def access_attribute_list(value)
      return "*" if value == "*"

      "(#{value.map { |name| identifier(name) }.join(', ')})"
    end

    def association_statement(app_module, entity, association)
      association_name = qualified(app_module.name, association.name)
      source = qualified(app_module.name, entity.name)
      target = qualified_reference(association.target)
      type = association.cardinality == "many" ? "ReferenceSet" : "Reference"
      owner = association.owner == "both" ? "Both" : "Default"

      "CREATE ASSOCIATION #{association_name}\n" \
        "  FROM #{source}\n" \
        "  TO #{target}\n" \
        "  TYPE #{type}\n" \
        "  OWNER #{owner};"
    end

    def attribute_type(attribute)
      if attribute.type == "enumeration"
        return "Enumeration(#{qualified_reference(attribute.options.fetch(:enumeration))})"
      end

      if attribute.type == "string"
        length = attribute.options[:length]
        return "String(#{length || 'unlimited'})"
      end

      TYPE_NAMES.fetch(attribute.type) do
        raise ValidationError, "cannot generate MDL type #{attribute.type.inspect}"
      end
    end

    def constraints(attribute)
      parts = []
      parts << "NOT NULL" if attribute.required
      parts << "DEFAULT #{literal(attribute.default)}" unless attribute.default.nil?
      parts.empty? ? "" : " #{parts.join(' ')}"
    end

    def literal(value)
      case value
      when true then "TRUE"
      when false then "FALSE"
      when Numeric then value.to_s
      when String then "'#{value.gsub("'", "''")}'"
      else
        raise ValidationError, "unsupported default value: #{value.inspect}"
      end
    end

    def escape_string(value)
      value.to_s.gsub("'", "''")
    end

    def qualified(module_name, item_name)
      "#{identifier(module_name)}.#{identifier(item_name)}"
    end

    def qualified_reference(value)
      parts = value.to_s.split(".", 2)
      raise ValidationError, "expected qualified reference, got #{value.inspect}" if parts.length != 2

      qualified(*parts)
    end

    def qualified_or_scalar(value)
      value.to_s.include?(".") ? qualified_reference(value) : identifier(value)
    end

    def identifier(value)
      string = value.to_s
      return string if string.match?(/\A[A-Za-z_][A-Za-z0-9_]*\z/)

      %("#{string.gsub('"', '""')}")
    end
  end
end
