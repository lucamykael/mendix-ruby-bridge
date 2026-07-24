# frozen_string_literal: true

require "spec_helper"

RSpec.describe MendixBridge::ChangePlanner do
  def plan(model, inventory)
    described_class.plan(model, inventory).operations
  end

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
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        module_role "Support", description: desired_description
      end
    end

    plan(model, module_role_inventory("Support desk"))
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
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        entity "Customer"
        entity "Order" do
          association "Order_Customer", target:, cardinality:
        end
      end
    end

    plan(model, association_inventory)
      .find { |candidate| candidate.type == "association" }
  end

  it "blocks entities in a nonexistent module" do
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        entity "Customer"
      end
    end

    operation = plan(model, MendixBridge::Inventory.new([])).first

    expect(operation).to have_attributes(
      action: "blocked",
      type: "module",
      name: "CRM",
      reason: include("module creation is not supported")
    )
  end

  it "keeps an unchanged module role and blocks a changed one" do
    expect(plan_module_role("Support desk").action).to eq("keep")

    changed = plan_module_role("Renamed desk")
    expect(changed).to have_attributes(
      action: "blocked",
      reason: include("not supported safely")
    )
    expect(changed.changes).to include(
      "from" => { "description" => "Support desk" },
      "to" => { "description" => "Renamed desk" }
    )
  end

  it "blocks an altered user role" do
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

    operation = plan(model, inventory).find { |candidate| candidate.type == "userrole" }

    expect(operation).to have_attributes(
      action: "blocked",
      reason: include("explicit ALTER support")
    )
    expect(operation.changes.dig("from", "module_roles")).to eq(["CRM.Support"])
    expect(operation.changes.dig("to", "module_roles")).to eq(["CRM.Admin"])
  end

  it "keeps an unchanged association and blocks a changed cardinality" do
    expect(plan_association(target: "CRM.Customer", cardinality: :one).action).to eq("keep")

    changed = plan_association(target: "CRM.Customer", cardinality: :many)
    expect(changed).to have_attributes(
      action: "blocked",
      reason: include("not supported safely")
    )
    expect(changed.changes.dig("from", "association_type")).to eq("Reference")
    expect(changed.changes.dig("to", "association_type")).to eq("ReferenceSet")
  end
end
