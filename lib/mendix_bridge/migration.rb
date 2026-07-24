# frozen_string_literal: true

module MendixBridge
  module Migration
    Operation = Data.define(:action, :type, :name, :options) do
      def to_h
        { action:, type:, name:, options: }.compact
      end
    end

    Plan = Data.define(:name, :operations) do
      def to_h
        { name:, operations: operations.map(&:to_h) }
      end
    end

    class Builder
      RENAMABLE_TYPES = %i[
        entity microflow nanoflow page enumeration association constant module
      ].freeze
      DROPPABLE_TYPES = %i[
        entity microflow nanoflow page enumeration association constant
      ].freeze

      def self.build(name, &block)
        builder = new(name)
        builder.instance_eval(&block)
        builder.result
      end

      def initialize(name)
        @name = name.to_s
        @operations = []
      end

      def rename(type, name, to:)
        type = checked_type(type, RENAMABLE_TYPES, "rename")
        name = type == "module" ? identifier!(name) : qualified!(name)
        add("rename", type, name, "to" => identifier!(to))
      end

      def drop(type, name)
        type = checked_type(type, DROPPABLE_TYPES, "drop")
        add("drop", type, qualified!(name))
      end

      def rename_attribute(entity, name, to:)
        entity = qualified!(entity)
        name = identifier!(name)
        add(
          "rename_attribute",
          "attribute",
          "#{entity}.#{name}",
          "entity" => entity,
          "attribute" => name,
          "to" => identifier!(to)
        )
      end

      def drop_attribute(entity, name)
        entity = qualified!(entity)
        name = identifier!(name)
        add(
          "drop_attribute",
          "attribute",
          "#{entity}.#{name}",
          "entity" => entity,
          "attribute" => name
        )
      end

      def rename_enumeration_value(enumeration, name, to:)
        enumeration = qualified!(enumeration)
        name = identifier!(name)
        add(
          "rename_enumeration_value",
          "enumeration_value",
          "#{enumeration}.#{name}",
          "enumeration" => enumeration,
          "value" => name,
          "to" => identifier!(to)
        )
      end

      def drop_enumeration_value(enumeration, name)
        enumeration = qualified!(enumeration)
        name = identifier!(name)
        add(
          "drop_enumeration_value",
          "enumeration_value",
          "#{enumeration}.#{name}",
          "enumeration" => enumeration,
          "value" => name
        )
      end

      def revoke_access(entity, role:)
        entity = qualified!(entity)
        role = qualified!(role)
        add(
          "revoke_access",
          "entity_access",
          "#{entity}:#{role}",
          "entity" => entity,
          "role" => role
        )
      end

      def alter_module_role(role, description:)
        raise ArgumentError, "module role description cannot be empty" if
          description.nil? || description.to_s.empty?

        add(
          "alter_module_role",
          "modulerole",
          qualified!(role),
          "description" => description.to_s
        )
      end

      def alter_user_role(name, module_roles:, manage_all_roles: false)
        roles = Array(module_roles).map { |role| qualified!(role) }
        raise ArgumentError, "user role requires at least one module role" if roles.empty?

        add(
          "alter_user_role",
          "userrole",
          identifier!(name),
          "module_roles" => roles,
          "manage_all_roles" => manage_all_roles ? true : false
        )
      end

      def result
        raise ArgumentError, "migration #{@name} requires at least one operation" if
          @operations.empty?

        Plan.new(name: @name, operations: @operations)
      end

      private

      def checked_type(type, allowed, action)
        type = type.to_sym
        return type.to_s if allowed.include?(type)

        raise ArgumentError,
          "unsupported #{action} type #{type.inspect}; expected: #{allowed.join(', ')}"
      end

      def add(action, type, name, options = nil)
        name = name.to_s
        raise ArgumentError, "migration target cannot be empty" if name.empty?

        @operations << Operation.new(action:, type:, name:, options:)
      end

      def identifier!(value)
        value = value.to_s
        return value if value.match?(/\A[A-Za-z_][A-Za-z0-9_]*\z/)

        raise ArgumentError, "invalid Mendix identifier: #{value.inspect}"
      end

      def qualified!(value)
        value = value.to_s
        parts = value.split(".")
        return value if parts.length == 2 && parts.all? do |part|
          part.match?(/\A[A-Za-z_][A-Za-z0-9_]*\z/)
        end

        raise ArgumentError, "expected qualified Mendix name: #{value.inspect}"
      end
    end

    class Generator
      DROP_TYPES = {
        "entity" => "ENTITY",
        "microflow" => "MICROFLOW",
        "nanoflow" => "NANOFLOW",
        "page" => "PAGE",
        "enumeration" => "ENUMERATION",
        "association" => "ASSOCIATION",
        "constant" => "CONSTANT"
      }.freeze

      def self.mdl(plan)
        plan.operations.filter_map { |operation| statement(operation) }.join("\n")
      end

      def self.rename_operations(plan)
        plan.operations.select { |operation| operation.action == "rename" }
      end

      def self.statement(operation)
        options = operation.options || {}
        case operation.action
        when "rename" then nil
        when "drop"
          "DROP #{DROP_TYPES.fetch(operation.type)} #{operation.name};"
        when "rename_attribute"
          "ALTER ENTITY #{options.fetch('entity')} RENAME ATTRIBUTE " \
            "#{options.fetch('attribute')} TO #{options.fetch('to')};"
        when "drop_attribute"
          "ALTER ENTITY #{options.fetch('entity')} DROP ATTRIBUTE " \
            "#{options.fetch('attribute')};"
        when "rename_enumeration_value"
          "ALTER ENUMERATION #{options.fetch('enumeration')} RENAME VALUE " \
            "#{options.fetch('value')} TO #{options.fetch('to')};"
        when "drop_enumeration_value"
          "ALTER ENUMERATION #{options.fetch('enumeration')} DROP VALUE " \
            "#{options.fetch('value')};"
        when "revoke_access"
          "REVOKE #{options.fetch('role')} ON #{options.fetch('entity')};"
        when "alter_module_role"
          "ALTER MODULE ROLE #{operation.name} " \
            "DESCRIPTION '#{escape(options.fetch('description'))}';"
        when "alter_user_role"
          management = options["manage_all_roles"] ? " MANAGE ALL ROLES" : ""
          "ALTER USER ROLE #{operation.name} " \
            "(#{options.fetch('module_roles').join(', ')})#{management};"
        else
          raise ArgumentError, "unsupported migration action: #{operation.action}"
        end
      end

      def self.escape(value)
        value.to_s.gsub("'", "''")
      end

      private_class_method :statement, :escape
    end
  end
end
