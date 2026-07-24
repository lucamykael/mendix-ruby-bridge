# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/mendix_bridge"

class VisualEntityPlanTest < Minitest::Test
  def setup
    @inventory = MendixBridge::Inventory.new(
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

  def test_builds_safe_preview_for_added_optional_attribute
    result = build(
      attributes: [
        attribute("Name"),
        attribute("Email", type: "string", length: 320)
      ]
    )

    assert result["ok"]
    assert_equal "modify", result.dig("operation", "action")
    assert_equal "Email", result.dig(
      "operation", "changes", "added_attributes", 0, "name"
    )
    assert_includes result["mdl"], "Email: String(320)"
  end

  def test_blocks_attribute_removal
    result = build(attributes: [])

    assert result["blocked"]
    assert_equal ["Name"], result.dig(
      "operation", "changes", "removed_attributes"
    )
    assert_includes result.dig("operation", "reason"), "destructive-change"
  end

  def test_rejects_duplicate_attributes
    error = assert_raises(ArgumentError) do
      build(attributes: [attribute("Name"), attribute("Name")])
    end

    assert_equal "duplicate attribute: Name", error.message
  end

  private

  def attribute(name, type: "string", length: 200)
    {
      "name" => name,
      "type" => type,
      "length" => length,
      "required" => false
    }
  end

  def build(attributes:)
    MendixBridge::VisualEntityPlan.build(
      inventory: @inventory,
      payload: {
        "qn" => "CRM.Customer",
        "persistable" => true,
        "attributes" => attributes
      }
    )
  end
end
