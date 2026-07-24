# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/mendix_bridge"

# Covers the ChangePlanner "blocked" and "keep" decisions that steer risky edits
# to explicit migrations. dsl_test.rb already covers the create/modify paths and
# the entity/enumeration removal blocks; this file pins the module, module-role,
# user-role, and association guards — the paths a future ALTER feature will touch.
class ChangePlannerTest < Minitest::Test
  def test_blocks_entities_in_a_nonexistent_module
    inventory = MendixBridge::Inventory.new([])
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        entity "Customer"
      end
    end

    operation = MendixBridge::ChangePlanner.plan(model, inventory).operations.first
    assert_equal "blocked", operation.action
    assert_equal "module", operation.type
    assert_equal "CRM", operation.name
    assert_includes operation.reason, "module creation is not supported"
  end

  def test_keeps_an_unchanged_module_role_and_blocks_a_changed_one
    keep = plan_module_role("Support desk")
    assert_equal "keep", keep.action

    changed = plan_module_role("Renamed desk")
    assert_equal "blocked", changed.action
    assert_equal({ "description" => "Support desk" }, changed.changes["from"])
    assert_equal({ "description" => "Renamed desk" }, changed.changes["to"])
    assert_includes changed.reason, "not supported safely"
  end

  def test_blocks_an_altered_user_role
    inventory = MendixBridge::Inventory.new(
      [{ "label" => "Support", "type" => "userrole", "qualifiedName" => "Support" }],
      details: {
        "Support" => {
          "parse_status" => "parsed",
          "module_roles" => ["CRM.Support"],
          "manage_all_roles" => false
        }
      }
    )
    model = MendixBridge.app("Example") do
      user_role "Support", module_roles: ["CRM.Admin"]
    end

    operation = MendixBridge::ChangePlanner.plan(model, inventory).operations
      .find { |candidate| candidate.type == "userrole" }
    assert_equal "blocked", operation.action
    assert_equal ["CRM.Support"], operation.changes.dig("from", "module_roles")
    assert_equal ["CRM.Admin"], operation.changes.dig("to", "module_roles")
    assert_includes operation.reason, "explicit ALTER support"
  end

  def test_keeps_an_unchanged_association_and_blocks_a_retargeted_one
    keep = plan_association(target: "CRM.Customer", cardinality: :one)
    assert_equal "keep", keep.action

    changed = plan_association(target: "CRM.Customer", cardinality: :many)
    assert_equal "blocked", changed.action
    assert_equal "Reference", changed.changes.dig("from", "association_type")
    assert_equal "ReferenceSet", changed.changes.dig("to", "association_type")
    assert_includes changed.reason, "not supported safely"
  end

  private

  def module_role_inventory(description)
    MendixBridge::Inventory.new(
      [
        {
          "label" => "CRM",
          "type" => "module",
          "qualifiedName" => "CRM",
          "children" => [
            { "label" => "Support", "type" => "modulerole", "qualifiedName" => "CRM.Support" }
          ]
        }
      ],
      details: {
        "CRM.Support" => { "parse_status" => "parsed", "description" => description }
      }
    )
  end

  def plan_module_role(desired_description)
    inventory = module_role_inventory("Support desk")
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        module_role "Support", description: desired_description
      end
    end
    MendixBridge::ChangePlanner.plan(model, inventory).operations
      .find { |candidate| candidate.type == "modulerole" }
  end

  def association_inventory
    MendixBridge::Inventory.new(
      [
        {
          "label" => "CRM",
          "type" => "module",
          "qualifiedName" => "CRM",
          "children" => [
            { "label" => "Customer", "type" => "entity", "qualifiedName" => "CRM.Customer" },
            { "label" => "Order", "type" => "entity", "qualifiedName" => "CRM.Order" },
            {
              "label" => "Order_Customer",
              "type" => "association",
              "qualifiedName" => "CRM.Order_Customer"
            }
          ]
        }
      ],
      details: {
        "CRM.Customer" => { "parse_status" => "parsed", "persistable" => true, "attributes" => [] },
        "CRM.Order" => { "parse_status" => "parsed", "persistable" => true, "attributes" => [] },
        "CRM.Order_Customer" => {
          "from" => "CRM.Order",
          "to" => "CRM.Customer",
          "association_type" => "Reference",
          "owner" => "Default"
        }
      }
    )
  end

  def plan_association(target:, cardinality:)
    inventory = association_inventory
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        entity "Customer"
        entity "Order" do
          association "Order_Customer", target:, cardinality:
        end
      end
    end
    MendixBridge::ChangePlanner.plan(model, inventory).operations
      .find { |candidate| candidate.type == "association" }
  end
end
