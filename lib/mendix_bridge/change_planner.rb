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
      operations.concat(@model.user_roles.map { |role| plan_user_role(role) })
      operations << plan_project_security(@model.project_security) if @model.project_security
      declared = operations.map { |operation| "#{operation.type}:#{operation.name}" }.to_set
      managed_types = %w[
        entity association enumeration microflow page
        modulerole userrole projectsecurity
      ]
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

      enumeration_operations = app_module.enumerations.map do |enumeration|
        plan_enumeration(app_module, enumeration)
      end
      microflow_operations = app_module.microflows.map do |microflow|
        plan_microflow(app_module, microflow)
      end
      page_operations = app_module.pages.map do |page|
        plan_page(app_module, page)
      end
      module_role_operations = app_module.module_roles.map do |role|
        plan_module_role(app_module, role)
      end
      entity_operations = app_module.entities.flat_map do |entity|
        [plan_entity(app_module, entity), *entity.associations.map do |association|
          plan_association(app_module, entity, association)
        end]
      end
      module_role_operations + enumeration_operations + entity_operations +
        microflow_operations + page_operations
    end

    def plan_module_role(app_module, role)
      name = "#{app_module.name}.#{role.name}"
      existing = @inventory.find(name)
      desired = { "description" => role.description }.compact
      return Operation.new(
        action: "create",
        type: "modulerole",
        name:,
        changes: desired,
        reason: nil
      ) unless existing

      details = existing.details
      unless existing.type == "modulerole" && details&.fetch("parse_status", nil) == "parsed"
        return Operation.new(
          action: "blocked",
          type: "modulerole",
          name:,
          changes: nil,
          reason: "existing module role does not have parsed semantic details"
        )
      end

      current = { "description" => details["description"] }.compact
      return Operation.new(
        action: "keep",
        type: "modulerole",
        name:,
        changes: nil,
        reason: nil
      ) if current == desired

      Operation.new(
        action: "blocked",
        type: "modulerole",
        name:,
        changes: { "from" => current, "to" => desired },
        reason: "modifying an existing module role is not supported safely"
      )
    end

    def plan_user_role(role)
      existing = @inventory.find(role.name)
      desired = {
        "module_roles" => role.module_roles,
        "manage_all_roles" => role.manage_all_roles
      }
      return Operation.new(
        action: "create",
        type: "userrole",
        name: role.name,
        changes: desired,
        reason: nil
      ) unless existing

      details = existing.details
      unless existing.type == "userrole" && details&.fetch("parse_status", nil) == "parsed"
        return Operation.new(
          action: "blocked",
          type: "userrole",
          name: role.name,
          changes: nil,
          reason: "existing user role does not have parsed semantic details"
        )
      end

      current = details.slice("module_roles", "manage_all_roles")
      return Operation.new(
        action: "keep",
        type: "userrole",
        name: role.name,
        changes: nil,
        reason: nil
      ) if current == desired

      Operation.new(
        action: "blocked",
        type: "userrole",
        name: role.name,
        changes: { "from" => current, "to" => desired },
        reason: "modifying an existing user role requires explicit ALTER support"
      )
    end

    def plan_project_security(security)
      existing = @inventory.find("ProjectSecurity")
      desired = {
        "SecurityLevel" => security.level.capitalize,
        "DemoUsersEnabled" => security.demo_users
      }
      unless existing&.details&.fetch("parse_status", nil) == "parsed"
        return Operation.new(
          action: "blocked",
          type: "projectsecurity",
          name: "ProjectSecurity",
          changes: nil,
          reason: "project security does not have parsed semantic details"
        )
      end

      current = existing.details.fetch("settings").slice(*desired.keys)
      if current == desired
        Operation.new(
          action: "keep",
          type: "projectsecurity",
          name: "ProjectSecurity",
          changes: nil,
          reason: nil
        )
      else
        Operation.new(
          action: "modify",
          type: "projectsecurity",
          name: "ProjectSecurity",
          changes: { "from" => current, "to" => desired },
          reason: nil
        )
      end
    end

    def plan_page(app_module, page)
      name = "#{app_module.name}.#{page.name}"
      existing = @inventory.find(name)
      desired = PageParser.parse(
        "mdl" => MDLGenerator.page_statement(app_module, page)
      )
      comparable_keys = %w[
        title layout folder parameters widgets data_sources actions
        microflow_calls nanoflow_calls page_links attributes view_roles
      ]
      desired = desired.slice(*comparable_keys)

      return Operation.new(
        action: "create",
        type: "page",
        name:,
        changes: desired,
        reason: nil
      ) unless existing

      details = existing.details
      unless existing.type == "page" && details&.fetch("parse_status", nil) == "parsed"
        return Operation.new(
          action: "blocked",
          type: "page",
          name:,
          changes: nil,
          reason: "existing page does not have parsed semantic details"
        )
      end

      current = details.slice(*comparable_keys)
      if current == desired
        Operation.new(action: "keep", type: "page", name:, changes: nil, reason: nil)
      else
        Operation.new(
          action: "modify",
          type: "page",
          name:,
          changes: { "from" => current, "to" => desired },
          reason: nil
        )
      end
    end

    def plan_microflow(app_module, microflow)
      name = "#{app_module.name}.#{microflow.name}"
      existing = @inventory.find(name)
      desired = MicroflowParser.parse(
        "mdl" => MDLGenerator.microflow_statement(app_module, microflow)
      )
      comparable_keys = %w[
        parameters return_type folder activities calls execute_roles
      ]
      desired = desired.slice(*comparable_keys)

      return Operation.new(
        action: "create",
        type: "microflow",
        name:,
        changes: desired,
        reason: nil
      ) unless existing

      details = existing.details
      unless existing.type == "microflow" && details&.fetch("parse_status", nil) == "parsed"
        return Operation.new(
          action: "blocked",
          type: "microflow",
          name:,
          changes: nil,
          reason: "existing microflow does not have parsed semantic details"
        )
      end

      current = details.slice(*comparable_keys)
      if current == desired
        Operation.new(action: "keep", type: "microflow", name:, changes: nil, reason: nil)
      else
        Operation.new(
          action: "modify",
          type: "microflow",
          name:,
          changes: { "from" => current, "to" => desired },
          reason: nil
        )
      end
    end

    def plan_enumeration(app_module, enumeration)
      name = "#{app_module.name}.#{enumeration.name}"
      existing = @inventory.find(name)
      desired = {
        "folder" => enumeration.folder,
        "values" => enumeration.values.map do |value|
          { "name" => value.name, "caption" => value.caption }
        end
      }.compact
      return Operation.new(
        action: "create",
        type: "enumeration",
        name:,
        changes: desired,
        reason: nil
      ) unless existing

      details = existing.details
      unless existing.type == "enumeration" && details&.fetch("parse_status", nil) == "parsed"
        return Operation.new(
          action: "blocked",
          type: "enumeration",
          name:,
          changes: nil,
          reason: "existing enumeration does not have parsed semantic details"
        )
      end

      current = {
        "folder" => details["folder"],
        "values" => details.fetch("values", [])
      }.compact
      return Operation.new(
        action: "keep",
        type: "enumeration",
        name:,
        changes: nil,
        reason: nil
      ) if current == desired

      current_names = current.fetch("values").map { |value| value.fetch("name") }
      desired_names = desired.fetch("values").map { |value| value.fetch("name") }
      removed = current_names - desired_names
      if removed.any?
        return Operation.new(
          action: "blocked",
          type: "enumeration",
          name:,
          changes: { "from" => current, "to" => desired, "removed_values" => removed },
          reason: "enumeration value removal requires explicit migration support"
        )
      end

      Operation.new(
        action: "modify",
        type: "enumeration",
        name:,
        changes: { "from" => current, "to" => desired },
        reason: nil
      )
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

      current_access = details.fetch("access_rules", []).map do |rule|
        comparable_access_rule(rule)
      end
      desired_access = entity.access_rules.map do |rule|
        comparable_access_rule(rule.to_h.transform_keys(&:to_s))
      end
      current_by_role = current_access.to_h { |rule| [rule.fetch("role"), rule] }
      desired_by_role = desired_access.to_h { |rule| [rule.fetch("role"), rule] }
      added_roles = desired_by_role.keys - current_by_role.keys
      removed_roles = current_by_role.keys - desired_by_role.keys
      modified_roles = (current_by_role.keys & desired_by_role.keys).filter_map do |role|
        before = current_by_role.fetch(role)
        after = desired_by_role.fetch(role)
        { "role" => role, "from" => before, "to" => after } unless before == after
      end
      changes["added_access_rules"] =
        added_roles.map { |role| desired_by_role.fetch(role) } unless added_roles.empty?
      changes["modified_access_rules"] = modified_roles unless modified_roles.empty?
      changes["removed_access_rules"] = removed_roles unless removed_roles.empty?
      changes
    end

    def unsafe_entity_reasons(changes)
      reasons = []
      if changes["removed_attributes"]&.any?
        reasons << "attribute removal requires explicit destructive-change support"
      end
      if changes["removed_access_rules"]&.any?
        reasons << "entity access removal requires explicit REVOKE support"
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

    def comparable_access_rule(rule)
      rule.slice("role", "create", "delete", "read", "write", "xpath")
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
