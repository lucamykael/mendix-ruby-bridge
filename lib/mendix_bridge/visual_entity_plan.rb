# frozen_string_literal: true

module MendixBridge
  class VisualEntityPlan
    TYPES = {
      "autonumber" => "autonumber",
      "binary" => "binary",
      "boolean" => "boolean",
      "datetime" => "datetime",
      "decimal" => "decimal",
      "hash_string" => "hash_string",
      "integer" => "integer",
      "long" => "long",
      "string" => "string"
    }.freeze

    def self.build(inventory:, payload:)
      new(inventory:, payload:).build
    end

    def initialize(inventory:, payload:)
      @inventory = inventory
      @payload = payload
    end

    def build
      qn = string!("qn")
      app_module, entity_name = qualified_name!(qn)
      attributes = array!("attributes").map { |attribute| build_attribute(attribute) }
      duplicate = attributes.group_by(&:name).find { |_name, values| values.length > 1 }
      raise ArgumentError, "duplicate attribute: #{duplicate.first}" if duplicate

      entity = Model::Entity.new(
        name: entity_name,
        persistable: boolean!("persistable"),
        attributes:,
        associations: [],
        access_rules: existing_access_rules(qn)
      )
      model = Model::App.new(
        name: "Visual editor",
        version: nil,
        modules: [
          Model::AppModule.new(
            name: app_module,
            entities: [entity],
            enumerations: [],
            microflows: [],
            pages: [],
            module_roles: []
          )
        ],
        user_roles: [],
        project_security: nil,
        navigation_profiles: []
      )
      operation = ChangePlanner.plan(model, @inventory).operations.find do |candidate|
        candidate.type == "entity" && candidate.name == qn
      end
      {
        "ok" => !operation.action.eql?("blocked"),
        "blocked" => operation.action.eql?("blocked"),
        "operation" => stringify(operation.to_h),
        "mdl" => MDLGenerator.new(model).generate
      }
    end

    private

    def build_attribute(value)
      raise ArgumentError, "attribute must be an object" unless value.is_a?(Hash)

      name = value.fetch("name")
      raise ArgumentError, "invalid attribute name" unless identifier?(name)

      raw_type = value.fetch("type").to_s.downcase
      type = TYPES[raw_type]
      options = {}
      if raw_type == "enumeration"
        type = "enumeration"
        enumeration = value.fetch("enumeration", "")
        qualified_name!(enumeration)
        options[:enumeration] = enumeration
      elsif raw_type == "string"
        length = value.fetch("length", 200)
        unless length.nil? || (length.is_a?(Integer) && length.positive?)
          raise ArgumentError, "string length must be a positive integer or null"
        end
        options[:length] = length
      end
      raise ArgumentError, "unsupported attribute type: #{raw_type}" unless type

      required = value.fetch("required", false)
      raise ArgumentError, "attribute required must be boolean" unless
        required == true || required == false

      Model::Attribute.new(
        name:,
        type:,
        required:,
        default: default_value(value["default"]),
        options:
      )
    rescue KeyError => error
      raise ArgumentError, "missing attribute field: #{error.key}"
    end

    def string!(key)
      value = @payload.fetch(key)
      raise ArgumentError, "#{key} must be a string" unless value.is_a?(String)

      value
    rescue KeyError
      raise ArgumentError, "missing field: #{key}"
    end

    def array!(key)
      value = @payload.fetch(key)
      raise ArgumentError, "#{key} must be an array" unless value.is_a?(Array)

      value
    rescue KeyError
      raise ArgumentError, "missing field: #{key}"
    end

    def boolean!(key)
      value = @payload.fetch(key)
      raise ArgumentError, "#{key} must be boolean" unless value == true || value == false

      value
    rescue KeyError
      raise ArgumentError, "missing field: #{key}"
    end

    def qualified_name!(value)
      parts = value.to_s.split(".", 2)
      raise ArgumentError, "invalid qualified name: #{value}" unless
        parts.length == 2 && parts.all? { |part| identifier?(part) }

      parts
    end

    def identifier?(value)
      value.is_a?(String) && value.match?(/\A[A-Za-z_]\w*\z/)
    end

    def existing_access_rules(qn)
      details = @inventory.find(qn)&.details || {}
      details.fetch("access_rules", []).map do |rule|
        Model::AccessRule.new(
          role: rule.fetch("role"),
          create: rule["create"],
          delete: rule["delete"],
          read: rule.fetch("read", []),
          write: rule.fetch("write", []),
          xpath: rule["xpath"]
        )
      end
    end

    def default_value(value)
      return nil if value.nil? || value == ""
      return true if value == true || value == "true"
      return false if value == false || value == "false"
      return value if value.is_a?(Numeric)
      return Integer(value, 10) if value.is_a?(String) && value.match?(/\A-?\d+\z/)
      return Float(value) if value.is_a?(String) && value.match?(/\A-?\d+\.\d+\z/)

      value.to_s.match?(/\A'.*'\z/) ? value.to_s[1...-1].gsub("''", "'") : value.to_s
    end

    def stringify(value)
      JSON.parse(JSON.generate(value))
    end
  end
end
