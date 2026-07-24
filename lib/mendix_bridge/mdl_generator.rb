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

    def self.generate(model, skip_associations: [])
      new(model, skip_associations:).generate
    end

    def initialize(model, skip_associations: [])
      @model = model
      @skip_associations = skip_associations
    end

    def generate
      statements = @model.modules.flat_map do |app_module|
        enumerations = app_module.enumerations.map do |enumeration|
          enumeration_statement(app_module, enumeration)
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

        enumerations + entities + associations
      end

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

    def entity_statement(app_module, entity)
      persistence = entity.persistable ? "PERSISTENT" : "NON-PERSISTENT"
      qualified_name = qualified(app_module.name, entity.name)

      attributes = entity.attributes.map do |attribute|
        "  #{identifier(attribute.name)}: #{attribute_type(attribute)}" \
          "#{constraints(attribute)}"
      end

      "CREATE OR MODIFY #{persistence} ENTITY #{qualified_name} (\n" \
        "#{attributes.join(",\n")}\n" \
        ");"
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

    def identifier(value)
      string = value.to_s
      return string if string.match?(/\A[A-Za-z_][A-Za-z0-9_]*\z/)

      %("#{string.gsub('"', '""')}")
    end
  end
end
