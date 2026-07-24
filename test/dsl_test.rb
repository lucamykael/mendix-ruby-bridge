# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/mendix_bridge"

class DSLTest < Minitest::Test
  def test_builds_an_application_model
    model = MendixBridge.app("Example", version: "1.0") do
      modulo "CRM" do
        entity "Customer" do
          attribute "Name", :string, required: true
          association "Customer_Orders", target: "Sales.Order", cardinality: :many
        end
      end
    end

    result = model.to_h

    assert_equal 1, result[:schema_version]
    assert_equal "Example", result.dig(:app, :name)
    assert_equal "CRM", result.dig(:modules, 0, :name)
    assert_equal "Customer", result.dig(:modules, 0, :entities, 0, :name)
    assert_equal "string", result.dig(:modules, 0, :entities, 0, :attributes, 0, :type)
    assert_equal "many", result.dig(:modules, 0, :entities, 0, :associations, 0, :cardinality)
  end

  def test_rejects_duplicate_entities
    error = assert_raises(ArgumentError) do
      MendixBridge.app("Example") do
        modulo "CRM" do
          entity "Customer"
          entity "Customer"
        end
      end
    end

    assert_equal "duplicate entity: Customer", error.message
  end

  def test_generates_json_from_root_dsl
    json = MendixBridge.generate do
      app "Example" do
        modulo "CRM"
      end
    end

    assert_equal "Example", JSON.parse(json).dig("app", "name")
  end

  def test_rejects_an_unknown_attribute_type
    error = assert_raises(ArgumentError) do
      MendixBridge.app("Example") do
        modulo "CRM" do
          entity "Customer" do
            attribute "Name", :varchar
          end
        end
      end
    end

    assert_match "unsupported attribute type :varchar", error.message
  end

  def test_rejects_an_association_to_an_unknown_entity
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        entity "Customer" do
          association "Customer_Orders", target: "Sales.Order"
        end
      end
    end

    error = assert_raises(MendixBridge::ValidationError) do
      MendixBridge.validate!(model)
    end

    assert_match "targets unknown entity Sales.Order", error.message
  end

  def test_generates_idempotent_mdl
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        entity "Customer" do
          attribute "Name", :string, required: true
          attribute "Active", :boolean, default: true
        end
      end

      modulo "Sales" do
        entity "Order", persistable: false do
          attribute "Total", :decimal, default: 0
          association "Order_Customer", target: "CRM.Customer"
        end
      end
    end

    mdl = MendixBridge.compile(model, format: :mdl)

    assert_includes mdl, "CREATE OR MODIFY PERSISTENT ENTITY CRM.Customer"
    assert_includes mdl, "Name: String(200) NOT NULL"
    assert_includes mdl, "Active: Boolean DEFAULT TRUE"
    assert_includes mdl, "CREATE OR MODIFY NON-PERSISTENT ENTITY Sales.Order"
    assert_includes mdl, "FROM Sales.Order"
    assert_includes mdl, "TO CRM.Customer"
    assert_includes mdl, "TYPE Reference"
  end

  def test_generates_configured_string_and_enumeration_types
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        entity "Customer" do
          attribute "Notes", :string, length: nil
          attribute "Status",
            :enumeration,
            enumeration: "CRM.CustomerStatus",
            default: "Active"
        end
      end
    end

    mdl = MendixBridge.compile(model, format: :mdl)

    assert_includes mdl, "Notes: String(unlimited)"
    assert_includes mdl, "Status: Enumeration(CRM.CustomerStatus) DEFAULT 'Active'"
  end

  def test_can_skip_an_existing_association
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        entity "Customer"
        entity "Order" do
          association "Order_Customer", target: "CRM.Customer"
        end
      end
    end

    mdl = MendixBridge.compile(
      model,
      format: :mdl,
      skip_associations: ["CRM.Order_Customer"]
    )

    refute_includes mdl, "CREATE ASSOCIATION"
  end

  def test_inventory_can_search_and_group_project_elements
    inventory = MendixBridge::Inventory.new(
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
            },
            {
              "label" => "ACT_SaveCustomer",
              "type" => "microflow",
              "qualifiedName" => "CRM.ACT_SaveCustomer"
            }
          ]
        }
      ]
    )

    assert_equal ["CRM"], inventory.modules.map(&:qualified_name)
    assert_equal ["CRM.Customer"], inventory.of_type(:entity).map(&:qualified_name)
    assert_equal "CRM.ACT_SaveCustomer", inventory.search("save").first.qualified_name
    assert_equal "Customer", inventory.find("CRM.Customer").label
    assert_equal ["CRM", "Customer"], inventory.find("CRM.Customer").path
  end

  def test_parses_entity_details_without_discarding_original_mdl
    mdl = <<~MDL
      create or modify persistent entity CRM.Customer extends System.User (
        Name: String(200) not null,
        Active: Boolean default true
      );
      /
    MDL
    details = MendixBridge::DomainParser.parse(
      "type" => "entity", "name" => "CRM.Customer", "mdl" => mdl
    )

    assert_equal true, details["persistable"]
    assert_equal "System.User", details["generalization"]
    assert_equal "Name", details.dig("attributes", 0, "name")
    assert_equal "String(200)", details.dig("attributes", 0, "type")
    assert_equal true, details.dig("attributes", 0, "required")
    assert_equal "true", details.dig("attributes", 1, "default")
    assert_equal mdl, details["mdl"]
  end

  def test_parses_entity_access_rules
    details = MendixBridge::DomainParser.parse(
      "type" => "entity",
      "name" => "CRM.Customer",
      "mdl" => <<~MDL
        create or modify persistent entity CRM.Customer (
          Name: String(200)
        );

        grant CRM.Admin on CRM.Customer (create, delete, read *, write (Name));
        grant CRM.User on CRM.Customer (read (Name)) where '[Owner = ''[%CurrentUser%]'']';
        /
      MDL
    )

    admin, user = details["access_rules"]
    assert_equal true, admin["create"]
    assert_equal "*", admin["read"]
    assert_equal ["Name"], admin["write"]
    assert_equal false, user["create"]
    assert_equal ["Name"], user["read"]
    assert_equal "[Owner = '[%CurrentUser%]']", user["xpath"]
  end

  def test_parses_association_details
    details = MendixBridge::DomainParser.parse(
      "type" => "association",
      "name" => "CRM.Order_Customer",
      "mdl" => <<~MDL
        create association CRM.Order_Customer
        from CRM.Order to CRM.Customer
        type Reference
        owner Default;
        /
      MDL
    )

    assert_equal "CRM.Order", details["from"]
    assert_equal "CRM.Customer", details["to"]
    assert_equal "Reference", details["association_type"]
    assert_equal "Default", details["owner"]
  end

  def test_parses_microflow_parameters_activities_calls_and_roles
    details = MendixBridge::MicroflowParser.parse(
      "type" => "microflow",
      "name" => "CRM.SaveCustomer",
      "mdl" => <<~MDL
        create or modify microflow CRM.SaveCustomer (
          $Customer: CRM.Customer
        )
        returns Boolean
        folder 'Actions'
        begin
          @caption 'Can save?'
          if $Customer/Name != empty then
            $Result = call microflow CRM.Validate(Customer = $Customer);
            return $Result;
          else
            return false;
          end if;
        end;

        grant execute on microflow CRM.SaveCustomer to CRM.User;
        /
      MDL
    )

    assert_equal [{ "name" => "Customer", "type" => "CRM.Customer" }], details["parameters"]
    assert_equal "Boolean", details["return_type"]
    assert_equal "Actions", details["folder"]
    assert_equal "decision", details.dig("activities", 0, "kind")
    assert_equal "microflow_call", details.dig("activities", 1, "kind")
    assert_equal "CRM.Validate", details.dig("activities", 1, "target")
    assert_equal ["Result"], details["variables"]
    assert_equal ["CRM.Validate"], details["calls"]
    assert_equal ["CRM.User"], details["execute_roles"]
  end

  def test_parses_page_settings_widgets_data_and_actions
    details = MendixBridge::PageParser.parse(
      "type" => "page",
      "name" => "CRM.Customer_Edit",
      "mdl" => <<~MDL
        create or modify page CRM.Customer_Edit (
          Title: 'Edit Customer',
          Layout: Atlas_Core.PopupLayout,
          Folder: 'Customers',
          Params: { $Customer: CRM.Customer }
        ) {
          dataview dataView1 (DataSource: $Customer) {
            textbox nameBox (Attribute: Name)
            actionbutton saveButton (Action: microflow CRM.SaveCustomer)
            linkbutton cancelButton (Action: show_page CRM.Customer_Overview)
          }
        }

        grant view on page CRM.Customer_Edit to CRM.User;
      MDL
    )

    assert_equal "Edit Customer", details["title"]
    assert_equal "Atlas_Core.PopupLayout", details["layout"]
    assert_equal [{ "name" => "Customer", "type" => "CRM.Customer" }], details["parameters"]
    assert_equal 1, details.dig("widget_types", "dataview")
    assert_equal 1, details.dig("widget_types", "textbox")
    assert_equal ["$Customer"], details["data_sources"]
    assert_equal ["Name"], details["attributes"]
    assert_equal ["CRM.SaveCustomer"], details["microflow_calls"]
    assert_equal ["CRM.Customer_Overview"], details["page_links"]
    assert_equal ["CRM.User"], details["view_roles"]
  end

  def test_parses_project_and_user_role_security
    project = MendixBridge::SecurityParser.parse(
      "projectsecurity",
      [
        { "Property" => "CheckSecurity", "Value" => "true" },
        { "Property" => "UserRoles", "Value" => "2" }
      ]
    )
    role = MendixBridge::SecurityParser.parse(
      "userrole",
      {
        "mdl" => "create user role Administrator (System.Administrator, CRM.Admin) manage all roles;\n/\n-- Check security: enabled\n"
      }
    )

    assert_equal true, project.dig("settings", "CheckSecurity")
    assert_equal 2, project.dig("settings", "UserRoles")
    assert_equal ["System.Administrator", "CRM.Admin"], role["module_roles"]
    assert_equal true, role["manage_all_roles"]
    assert_equal true, role["check_security"]
  end

  def test_compares_imported_snapshots
    before = MendixBridge::Inventory.new(
      [
        { "label" => "Old", "type" => "entity", "qualifiedName" => "CRM.Old" },
        { "label" => "Customer", "type" => "entity", "qualifiedName" => "CRM.Customer" }
      ],
      details: {
        "CRM.Customer" => { "attributes" => [{ "name" => "Name" }] }
      }
    )
    after = MendixBridge::Inventory.new(
      [
        { "label" => "Customer", "type" => "entity", "qualifiedName" => "CRM.Customer" },
        { "label" => "Order", "type" => "entity", "qualifiedName" => "CRM.Order" }
      ],
      details: {
        "CRM.Customer" => { "attributes" => [{ "name" => "Name" }, { "name" => "Email" }] }
      }
    )

    changes = MendixBridge::SnapshotDiff.compare(before, after)

    assert_equal ["entity:CRM.Order"], changes.added.map { |item| item["id"] }
    assert_equal ["entity:CRM.Customer"], changes.modified.map { |item| item["id"] }
    assert_equal ["entity:CRM.Old"], changes.removed.map { |item| item["id"] }
  end

  def test_presents_an_element_without_large_raw_payloads
    inventory = MendixBridge::Inventory.new(
      [
        { "label" => "Customer", "type" => "entity", "qualifiedName" => "CRM.Customer" }
      ],
      details: {
        "CRM.Customer" => {
          "attributes" => [{ "name" => "Name" }],
          "mdl" => "create entity CRM.Customer;",
          "raw" => { "internal" => true }
        }
      }
    )
    element = inventory.find("CRM.Customer")
    summary = MendixBridge::Presenter.summary(element)

    assert_equal "CRM.Customer", summary["name"]
    assert_equal [{ "name" => "Name" }], summary.dig("details", "attributes")
    refute summary.fetch("details").key?("mdl")
    refute summary.fetch("details").key?("raw")
    assert_includes MendixBridge::Presenter.text(element), "Type: entity"
  end

  def test_plans_safe_changes_and_blocks_implicit_attribute_removal
    inventory = MendixBridge::Inventory.new(
      [
        {
          "label" => "CRM",
          "type" => "module",
          "qualifiedName" => "CRM",
          "children" => [
            { "label" => "Customer", "type" => "entity", "qualifiedName" => "CRM.Customer" },
            { "label" => "Order", "type" => "entity", "qualifiedName" => "CRM.Order" }
          ]
        }
      ],
      details: {
        "CRM.Customer" => {
          "parse_status" => "parsed",
          "persistable" => true,
          "attributes" => [
            { "name" => "Name", "type" => "String(200)", "required" => true },
            { "name" => "Legacy", "type" => "Boolean", "required" => false }
          ]
        },
        "CRM.Order" => {
          "parse_status" => "parsed",
          "persistable" => true,
          "attributes" => []
        }
      }
    )
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        entity "Customer" do
          attribute "Name", :string, required: true
        end
        entity "Order" do
          attribute "Number", :string
        end
        entity "Invoice"
      end
    end

    plan = MendixBridge::ChangePlanner.plan(model, inventory)
    operations = plan.operations.to_h { |operation| [operation.name, operation] }

    assert_equal "blocked", operations.fetch("CRM.Customer").action
    assert_equal ["Legacy"], operations.fetch("CRM.Customer").changes["removed_attributes"]
    assert_equal "modify", operations.fetch("CRM.Order").action
    assert_equal "create", operations.fetch("CRM.Invoice").action
    assert_equal true, plan.blocked?
  end
end
