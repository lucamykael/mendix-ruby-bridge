# frozen_string_literal: true

module MendixBridge
  class ChangePlanner
    Operation = Data.define(:action, :type, :name, :changes, :reason) do
      def to_h
        { action:, type:, name:, changes:, reason: }.compact
      end
    end

    Result = Data.define(:operations, :preserved_undeclared) do
      def counts
        operations.each_with_object(Hash.new(0)) do |operation, result|
          result[operation.action] += 1
        end.sort.to_h
      end

      def blocked?
        operations.any? { |operation| operation.action == "blocked" }
      end

      def to_h
        {
          operations: operations.map(&:to_h),
          counts:,
          preserved_undeclared:
        }
      end
    end

    TYPE_NAMES = MDLGenerator::TYPE_NAMES

    def self.plan(model, inventory)
      new(model, inventory).plan
    end

    def initialize(model, inventory)
      @model = model
      @inventory = inventory
    end

    def plan
      operations = @model.modules.flat_map { |app_module| plan_module(app_module) }
      declared = operations.map { |operation| "#{operation.type}:#{operation.name}" }.to_set
      managed_types = %w[entity association]
      preserved = @inventory.elements.count do |element|
        managed_types.include?(element.type) &&
          !declared.include?("#{element.type}:#{element.qualified_name}")
      end

      Result.new(operations:, preserved_undeclared: preserved)
    end

    private

    def plan_module(app_module)
      unless @inventory.modules.any? { |existing| existing.qualified_name == app_module.name }
        return [
          Operation.new(
            action: "blocked",
            type: "module",
            name: app_module.name,
            changes: nil,
            reason: "target module does not exist; module creation is not supported"
          )
        ]
      end

      app_module.entities.flat_map do |entity|
        [plan_entity(app_module, entity), *entity.associations.map do |association|
          plan_association(app_module, entity, association)
        end]
      end
    end

    def plan_entity(app_module, entity)
      name = "#{app_module.name}.#{entity.name}"
      existing = @inventory.find(name)
      return Operation.new(action: "create", type: "entity", name:, changes: nil, reason: nil) unless existing

      details = existing.details
      unless existing.type == "entity" && details&.fetch("parse_status", nil) == "parsed"
        return Operation.new(
          action: "blocked",
          type: "entity",
          name:,
          changes: nil,
          reason: "existing entity does not have parsed semantic details"
        )
      end

      changes = entity_changes(entity, details)
      unsafe_reasons = unsafe_entity_reasons(changes)
      if unsafe_reasons.any?
        Operation.new(
          action: "blocked",
          type: "entity",
          name:,
          changes:,
          reason: unsafe_reasons.join("; ")
        )
      elsif changes.empty?
        Operation.new(action: "keep", type: "entity", name:, changes: nil, reason: nil)
      else
        Operation.new(action: "modify", type: "entity", name:, changes:, reason: nil)
      end
    end

    def entity_changes(entity, details)
      changes = {}
      changes["persistable"] = {
        "from" => details["persistable"],
        "to" => entity.persistable
      } if details["persistable"] != entity.persistable

      current = details.fetch("attributes", []).to_h { |attribute| [attribute.fetch("name"), attribute] }
      desired = entity.attributes.to_h { |attribute| [attribute.name, desired_attribute(attribute)] }

      added = desired.keys - current.keys
      removed = current.keys - desired.keys
      modified = (current.keys & desired.keys).filter_map do |name|
        before = comparable_attribute(current.fetch(name))
        after = comparable_attribute(desired.fetch(name))
        { "name" => name, "from" => before, "to" => after } unless before == after
      end

      changes["added_attributes"] = added.map { |name| desired.fetch(name) } unless added.empty?
      changes["modified_attributes"] = modified unless modified.empty?
      changes["removed_attributes"] = removed unless removed.empty?
      changes
    end

    def unsafe_entity_reasons(changes)
      reasons = []
      if changes["removed_attributes"]&.any?
        reasons << "attribute removal requires explicit destructive-change support"
      end
      if changes.key?("persistable")
        reasons << "changing entity persistence requires explicit migration support"
      end
      if changes.fetch("modified_attributes", []).any? do |change|
        change.dig("from", "type") != change.dig("to", "type")
      end
        reasons << "changing an attribute type requires explicit migration support"
      end
      if changes.fetch("added_attributes", []).any? do |attribute|
        attribute["required"] && !attribute.key?("default")
      end
        reasons << "adding a required attribute without a default may invalidate existing data"
      end
      reasons
    end

    def plan_association(app_module, entity, association)
      name = "#{app_module.name}.#{association.name}"
      existing = @inventory.find(name)
      desired = {
        "from" => "#{app_module.name}.#{entity.name}",
        "to" => association.target,
        "association_type" => association.cardinality == "many" ? "ReferenceSet" : "Reference",
        "owner" => association.owner == "both" ? "Both" : "Default"
      }
      return Operation.new(action: "create", type: "association", name:, changes: desired, reason: nil) unless existing

      current = existing.details&.slice(*desired.keys)
      unless existing.type == "association" && current
        return Operation.new(
          action: "blocked",
          type: "association",
          name:,
          changes: nil,
          reason: "existing association does not have parsed semantic details"
        )
      end
      return Operation.new(action: "keep", type: "association", name:, changes: nil, reason: nil) if current == desired

      Operation.new(
        action: "blocked",
        type: "association",
        name:,
        changes: { "from" => current, "to" => desired },
        reason: "modifying an existing association is not supported safely"
      )
    end

    def desired_attribute(attribute)
      {
        "name" => attribute.name,
        "type" => attribute_type(attribute),
        "required" => attribute.required,
        "default" => default_value(attribute.default)
      }.compact
    end

    def comparable_attribute(attribute)
      attribute.slice("name", "type", "required", "default")
    end

    def attribute_type(attribute)
      return "Enumeration(#{attribute.options.fetch(:enumeration)})" if attribute.type == "enumeration"
      return "String(#{attribute.options[:length] || 'unlimited'})" if attribute.type == "string"

      TYPE_NAMES.fetch(attribute.type)
    end

    def default_value(value)
      case value
      when nil then nil
      when true then "true"
      when false then "false"
      when Numeric then value.to_s
      when String then "'#{value.gsub("'", "''")}'"
      end
    end
  end
end
