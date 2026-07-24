# frozen_string_literal: true

require "spec_helper"

RSpec.describe MendixBridge::VisualEntityPlan do
  subject(:build_plan) do
    described_class.build(
      inventory: inventory,
      payload: {
        "qn" => "CRM.Customer",
        "persistable" => true,
        "attributes" => attributes
      }
    )
  end

  let(:inventory) do
    MendixBridge::Inventory.new(
      [
        {
          "label" => "CRM",
          "type" => "module",
          "qualifiedName" => "CRM",
          "children" => [
            {
              "label" => "Customer",
              "type" => "entity",
              "qualifiedName" => "CRM.Customer"
            }
          ]
        }
      ],
      details: {
        "CRM.Customer" => {
          "parse_status" => "parsed",
          "persistable" => true,
          "attributes" => [
            {
              "name" => "Name",
              "type" => "String(200)",
              "required" => false
            }
          ],
          "access_rules" => []
        }
      }
    )
  end

  def attribute(name, type: "string", length: 200)
    {
      "name" => name,
      "type" => type,
      "length" => length,
      "required" => false
    }
  end

  context "when adding an optional attribute" do
    let(:attributes) do
      [
        attribute("Name"),
        attribute("Email", type: "string", length: 320)
      ]
    end

    it "builds a safe modification preview" do
      expect(build_plan).to include(
        "ok" => true,
        "operation" => include(
          "action" => "modify",
          "changes" => include(
            "added_attributes" => [include("name" => "Email")]
          )
        ),
        "mdl" => include("Email: String(320)")
      )
    end
  end

  context "when removing an attribute" do
    let(:attributes) { [] }

    it "blocks the destructive change" do
      expect(build_plan).to include(
        "blocked" => true,
        "operation" => include(
          "changes" => include("removed_attributes" => ["Name"]),
          "reason" => include("destructive-change")
        )
      )
    end
  end

  context "when attribute names are duplicated" do
    let(:attributes) { [attribute("Name"), attribute("Name")] }

    it "rejects the plan" do
      expect { build_plan }
        .to raise_error(ArgumentError, "duplicate attribute: Name")
    end
  end
end
