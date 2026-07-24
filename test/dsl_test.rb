# frozen_string_literal: true

require "minitest/autorun"
require "tmpdir"
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

  def test_builds_and_generates_enumerations
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        enumeration "CustomerStatus", folder: "Domain/Enums" do
          value "Active"
          value "Waiting", caption: "Waiting for customer's response"
        end
      end
    end

    assert_equal "CustomerStatus", model.to_h.dig(:modules, 0, :enumerations, 0, :name)
    assert_equal "Active", model.to_h.dig(
      :modules, 0, :enumerations, 0, :values, 0, :caption
    )

    mdl = MendixBridge.compile(model, format: :mdl)
    assert_includes mdl, "CREATE OR MODIFY ENUMERATION CRM.CustomerStatus"
    assert_includes mdl, "Active 'Active'"
    assert_includes mdl, "Waiting 'Waiting for customer''s response'"
    assert_includes mdl, ") FOLDER 'Domain/Enums';"
  end

  def test_generates_module_bootstrap_for_new_projects
    model = MendixBridge.app("Example") do
      modulo "CRM"
      modulo "Existing"
    end

    mdl = MendixBridge.compile(
      model,
      format: :mdl,
      include_modules: true,
      skip_modules: ["Existing"]
    )

    assert_includes mdl, "CREATE MODULE CRM;"
    refute_includes mdl, "CREATE MODULE Existing;"
  end

  def test_project_creator_rejects_invalid_version_before_creation
    Dir.mktmpdir do |directory|
      creator = MendixBridge::ProjectCreator.new(
        mxcli: File.expand_path("../bin/mxcli", __dir__)
      )
      model = MendixBridge.app("Example") { modulo "CRM" }

      error = assert_raises(MendixBridge::ProjectCreationError) do
        creator.create(
          model,
          source_file: __FILE__,
          output_dir: File.join(directory, "project"),
          version: "latest",
          git: false
        )
      end

      assert_equal "invalid Mendix version: latest", error.message
      refute_path_exists File.join(directory, "project")
    end
  end

  def test_builds_explicit_destructive_migration
    migration = MendixBridge.migration("remove-legacy-customer-data") do
      rename :entity, "CRM.Customer", to: "Client"
      rename_attribute "CRM.Client", "Email", to: "EmailAddress"
      drop_attribute "CRM.Client", "Legacy"
      rename_enumeration_value "CRM.Status", "Waiting", to: "Pending"
      drop_enumeration_value "CRM.Status", "Obsolete"
      revoke_access "CRM.Client", role: "CRM.LegacyUser"
      drop :microflow, "CRM.ACT_Legacy"
    end

    assert_equal 7, migration.operations.length
    renames = MendixBridge::Migration::Generator.rename_operations(migration)
    assert_equal "CRM.Customer", renames.first.name
    assert_equal "Client", renames.first.options["to"]

    mdl = MendixBridge::Migration::Generator.mdl(migration)
    assert_includes mdl,
      "ALTER ENTITY CRM.Client RENAME ATTRIBUTE Email TO EmailAddress;"
    assert_includes mdl, "ALTER ENTITY CRM.Client DROP ATTRIBUTE Legacy;"
    assert_includes mdl,
      "ALTER ENUMERATION CRM.Status RENAME VALUE Waiting TO Pending;"
    assert_includes mdl, "ALTER ENUMERATION CRM.Status DROP VALUE Obsolete;"
    assert_includes mdl, "REVOKE CRM.LegacyUser ON CRM.Client;"
    assert_includes mdl, "DROP MICROFLOW CRM.ACT_Legacy;"
    refute_includes mdl, "CRM.Customer"
  end

  def test_rejects_unknown_migration_operation_types
    error = assert_raises(ArgumentError) do
      MendixBridge.migration("bad") { drop :database, "CRM.Data" }
    end

    assert_match "unsupported drop type :database", error.message
  end

  def test_rejects_invalid_migration_identifiers
    error = assert_raises(ArgumentError) do
      MendixBridge.migration("unsafe") do
        drop :entity, "CRM.Customer; DROP MODULE CRM"
      end
    end

    assert_match "expected qualified Mendix name", error.message
  end

  def test_builds_and_queries_cross_reference_dependency_index
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
              "label" => "ACT_Save",
              "type" => "microflow",
              "qualifiedName" => "CRM.ACT_Save"
            },
            {
              "label" => "SUB_Validate",
              "type" => "microflow",
              "qualifiedName" => "CRM.SUB_Validate"
            },
            {
              "label" => "Customer_Edit",
              "type" => "page",
              "qualifiedName" => "CRM.Customer_Edit"
            }
          ]
        }
      ],
      details: {
        "CRM.Customer" => {
          "generalization" => "System.User",
          "mdl" => "create entity CRM.Customer;"
        },
        "CRM.ACT_Save" => {
          "parameters" => [{ "name" => "Customer", "type" => "CRM.Customer" }],
          "calls" => ["CRM.SUB_Validate"],
          "mdl" => "call microflow CRM.SUB_Validate;"
        },
        "CRM.SUB_Validate" => {
          "mdl" => "retrieve CRM.Customer;"
        },
        "CRM.Customer_Edit" => {
          "microflow_calls" => ["CRM.ACT_Save"],
          "mdl" => "Action: microflow CRM.ACT_Save"
        }
      }
    )

    index = MendixBridge::DependencyIndex.new(inventory)

    assert_equal ["CRM.SUB_Validate"], index.callees("CRM.ACT_Save").map(&:to).uniq
    assert_equal ["CRM.ACT_Save"], index.callers("CRM.SUB_Validate").map(&:from).uniq
    assert_includes index.dependencies("CRM.ACT_Save").map(&:to), "CRM.Customer"
    assert_includes index.impact("CRM.Customer").map(&:from), "CRM.ACT_Save"
    assert_includes index.impact("CRM.Customer").map(&:from), "CRM.Customer_Edit"
    assert_equal 5, index.to_h[:nodes]
  end

  def test_writes_and_discovers_project_configuration
    Dir.mktmpdir do |directory|
      project = File.join(directory, "mendix", "App.mpr")
      inventory = File.join(directory, "ruby-inventory")
      model = File.join(directory, "app.rb")
      FileUtils.mkdir_p(File.dirname(project))
      FileUtils.mkdir_p(inventory)
      File.write(project, "")
      File.write(model, "")

      config = MendixBridge::Config.write(
        File.join(directory, ".mendix-ruby.yml"),
        project:,
        inventory:,
        model:
      )
      nested = File.join(directory, "workspace", "nested")
      FileUtils.mkdir_p(nested)
      discovered = MendixBridge::Config.find(nested)

      assert_equal config.path, discovered.path
      assert_equal project, discovered.project
      assert_equal inventory, discovered.inventory
      assert_equal model, discovered.model
      assert_includes File.read(config.path), "project: mendix/App.mpr"
    end
  end

  def test_rejects_unknown_configuration_keys
    Dir.mktmpdir do |directory|
      path = File.join(directory, ".mendix-ruby.yml")
      File.write(path, "version: 1\nproject: App.mpr\nsurprise: true\n")

      error = assert_raises(MendixBridge::ConfigError) do
        MendixBridge::Config.load(path)
      end

      assert_equal "unknown configuration keys: surprise", error.message
    end
  end

  def test_rejects_empty_or_duplicate_enumeration_values
    assert_raises(ArgumentError) do
      MendixBridge.app("Example") do
        modulo "CRM" do
          enumeration "Empty"
        end
      end
    end

    assert_raises(ArgumentError) do
      MendixBridge.app("Example") do
        modulo "CRM" do
          enumeration "Status" do
            value "Active"
            value "Active"
          end
        end
      end
    end
  end

  def test_builds_generates_and_plans_microflows
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        microflow "ACT_Save", returns: "Boolean", folder: "Actions" do
          parameter "Customer", "CRM.Customer"
          body <<~MDL
            $Valid = call microflow CRM.SUB_Validate(Customer = $Customer);
            return $Valid;
          MDL
          execute_role "CRM.User"
        end
      end
    end

    mdl = MendixBridge.compile(model, format: :mdl)
    assert_includes mdl, "CREATE OR MODIFY MICROFLOW CRM.ACT_Save"
    assert_includes mdl, "$Customer: CRM.Customer"
    assert_includes mdl, "RETURNS Boolean"
    assert_includes mdl, "FOLDER 'Actions'"
    assert_includes mdl, "GRANT EXECUTE ON MICROFLOW CRM.ACT_Save TO CRM.User;"

    inventory = MendixBridge::Inventory.new(
      [
        {
          "label" => "CRM",
          "type" => "module",
          "qualifiedName" => "CRM"
        }
      ]
    )
    operation = MendixBridge::ChangePlanner.plan(model, inventory).operations.first
    assert_equal "create", operation.action
    assert_equal "microflow", operation.type
    assert_equal ["CRM.SUB_Validate"], operation.changes["calls"]
  end

  def test_builds_generates_and_plans_pages
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        page "Customer_Edit",
          title: "Edit Customer",
          layout: "Atlas_Core.PopupLayout",
          folder: "Customers" do
          parameter "Customer", "CRM.Customer"
          content <<~MDL
            dataview dataView1 (DataSource: $Customer) {
              textbox nameBox (Attribute: Name)
              actionbutton saveButton (Action: microflow CRM.ACT_Save)
            }
          MDL
          view_role "CRM.User"
        end
      end
    end

    mdl = MendixBridge.compile(model, format: :mdl)
    assert_includes mdl, "CREATE OR MODIFY PAGE CRM.Customer_Edit"
    assert_includes mdl, "Title: 'Edit Customer'"
    assert_includes mdl, "Layout: Atlas_Core.PopupLayout"
    assert_includes mdl, "Params: { $Customer: CRM.Customer }"
    assert_includes mdl, "GRANT VIEW ON PAGE CRM.Customer_Edit TO CRM.User;"

    inventory = MendixBridge::Inventory.new(
      [{ "label" => "CRM", "type" => "module", "qualifiedName" => "CRM" }]
    )
    operation = MendixBridge::ChangePlanner.plan(model, inventory).operations.first
    assert_equal "create", operation.action
    assert_equal "page", operation.type
    assert_equal ["CRM.ACT_Save"], operation.changes["microflow_calls"]
  end

  def test_builds_generates_and_plans_security
    model = MendixBridge.app("Example") do
      project_security level: :production, demo_users: false
      user_role "Support", module_roles: ["CRM.Support"]

      modulo "CRM" do
        module_role "Support", description: "Customer support"
      end
    end

    mdl = MendixBridge.compile(model, format: :mdl)
    assert_includes mdl,
      "CREATE MODULE ROLE CRM.Support DESCRIPTION 'Customer support';"
    assert_includes mdl, "CREATE USER ROLE Support (CRM.Support);"
    assert_includes mdl, "ALTER PROJECT SECURITY LEVEL PRODUCTION;"
    assert_includes mdl, "ALTER PROJECT SECURITY DEMO USERS OFF;"

    skipped = MendixBridge.compile(
      model,
      format: :mdl,
      skip_module_roles: ["CRM.Support"],
      skip_user_roles: ["Support"]
    )
    refute_includes skipped, "CREATE MODULE ROLE"
    refute_includes skipped, "CREATE USER ROLE"
    assert_includes skipped, "ALTER PROJECT SECURITY LEVEL PRODUCTION;"

    inventory = MendixBridge::Inventory.new(
      [
        { "label" => "CRM", "type" => "module", "qualifiedName" => "CRM" },
        {
          "label" => "Project Security",
          "type" => "projectsecurity",
          "qualifiedName" => "ProjectSecurity"
        }
      ],
      details: {
        "ProjectSecurity" => {
          "parse_status" => "parsed",
          "settings" => {
            "SecurityLevel" => "Prototype",
            "DemoUsersEnabled" => true
          }
        }
      }
    )
    operations = MendixBridge::ChangePlanner.plan(model, inventory).operations
      .to_h { |operation| [operation.name, operation] }
    assert_equal "create", operations.fetch("CRM.Support").action
    assert_equal "create", operations.fetch("Support").action
    assert_equal "modify", operations.fetch("ProjectSecurity").action
  end

  def test_generates_entity_access_rules
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        entity "Customer" do
          attribute "Name", :string
          attribute "Secret", :string
          access "CRM.Admin",
            create: true,
            delete: true,
            read: :all,
            write: %w[Name Secret]
          access "CRM.User",
            read: ["Name"],
            write: ["Name"],
            where: "[Owner = '[%CurrentUser%]']"
        end
      end
    end

    mdl = MendixBridge.compile(model, format: :mdl)
    assert_includes mdl,
      "GRANT CRM.Admin ON CRM.Customer " \
      "(CREATE, DELETE, READ *, WRITE (Name, Secret));"
    assert_includes mdl,
      "GRANT CRM.User ON CRM.Customer " \
      "(READ (Name), WRITE (Name)) WHERE '[Owner = ''[%CurrentUser%]'']';"
  end

  def test_builds_generates_and_plans_navigation
    model = MendixBridge.app("Example") do
      navigation_profile "Responsive",
        home_page: "CRM.Home",
        login_page: "CRM.Login",
        not_found_page: "CRM.NotFound" do
        home_page "CRM.AdminHome", for_role: "CRM.Admin"
        menu_item "Home", page: "CRM.Home"
        menu "Customers" do
          menu_item "Overview", page: "CRM.Customer_Overview"
          menu_item "Refresh", nanoflow: "CRM.ACT_Refresh"
        end
      end

      modulo "CRM"
    end

    mdl = MendixBridge.compile(model, format: :mdl)
    assert_includes mdl, "CREATE OR REPLACE NAVIGATION Responsive"
    assert_includes mdl, "HOME PAGE CRM.AdminHome FOR CRM.Admin"
    assert_includes mdl, "LOGIN PAGE CRM.Login"
    assert_includes mdl, "NOT FOUND PAGE CRM.NotFound"
    assert_includes mdl, "MENU 'Customers' ("
    assert_includes mdl, "MENU ITEM 'Refresh' NANOFLOW CRM.ACT_Refresh;"

    inventory = MendixBridge::Inventory.new(
      [{ "label" => "CRM", "type" => "module", "qualifiedName" => "CRM" }]
    )
    operation = MendixBridge::ChangePlanner.plan(model, inventory).operations
      .find { |candidate| candidate.type == "navprofile" }
    assert_equal "create", operation.action
    assert_equal "CRM.Home", operation.changes["home_page"]
    assert_equal ["Customers"], operation.changes["menu_groups"]
    assert_equal "CRM.ACT_Refresh", operation.changes.dig("menu_items", 2, "target")
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
    assert_equal ["CRM.Validate"], details["microflow_calls"]
    assert_equal ["CRM.User"], details["execute_roles"]
  end

  def test_parses_nanoflow_and_client_side_calls
    details = MendixBridge::MicroflowParser.parse(
      "type" => "nanoflow",
      "name" => "CRM.ACT_Save",
      "mdl" => <<~MDL
        create or modify nanoflow CRM.ACT_Save (
          $Customer: CRM.Customer
        )
        folder 'Nanoflows'
        begin
          $Status = call javascript action Native.Save(Customer = $Customer);
          call nanoflow CRM.SUB_Refresh(Customer = $Customer);
          return;
        end;
        /
      MDL
    )

    assert_equal "parsed", details["parse_status"]
    assert_equal "javascript_action_call", details.dig("activities", 0, "kind")
    assert_equal "Native.Save", details.dig("activities", 0, "target")
    assert_equal "nanoflow_call", details.dig("activities", 1, "kind")
    assert_equal ["Native.Save", "CRM.SUB_Refresh"], details["calls"]
    assert_equal ["CRM.SUB_Refresh"], details["nanoflow_calls"]
    assert_equal ["Native.Save"], details["javascript_action_calls"]
  end

  def test_parses_enumeration_values_and_folder
    details = MendixBridge::EnumerationParser.parse(
      "type" => "enumeration",
      "name" => "CRM.CustomerStatus",
      "mdl" => <<~MDL
        create or modify enumeration CRM.CustomerStatus (
          Active 'Active',
          Waiting 'Waiting for customer',
          Customer_s_choice 'Customer''s choice'
        ) FOLDER 'Domain/Enums';
        /
      MDL
    )

    assert_equal "parsed", details["parse_status"]
    assert_equal "Domain/Enums", details["folder"]
    assert_equal(
      [
        { "name" => "Active", "caption" => "Active" },
        { "name" => "Waiting", "caption" => "Waiting for customer" },
        { "name" => "Customer_s_choice", "caption" => "Customer's choice" }
      ],
      details["values"]
    )
  end

  def test_parses_constant_and_java_action_documents
    constant = MendixBridge::DocumentParser.parse(
      "constant",
      "mdl" => <<~MDL
        create or modify constant CRM.ApiKey
          type String
          default 'customer''s key'
          folder 'Configuration';
        /
      MDL
    )
    action = MendixBridge::DocumentParser.parse(
      "javaaction",
      "mdl" => <<~MDL
        create java action CRM.Validate(
            Value: String not null  -- Value to validate
        ) returns Boolean
        as $$
        // Java source not available from this project; body omitted by DESCRIBE.
        $$;
      MDL
    )

    assert_equal "String", constant["data_type"]
    assert_equal "customer's key", constant["default"]
    assert_equal "Configuration", constant["folder"]
    assert_equal "Boolean", action["return_type"]
    assert_equal false, action["source_available"]
    assert_equal(
      {
        "name" => "Value",
        "type" => "String",
        "required" => true,
        "description" => "Value to validate"
      },
      action["parameters"].first
    )
  end

  def test_parses_mapping_layout_and_navigation_documents
    mapping = MendixBridge::DocumentParser.parse(
      "exportmapping",
      "mdl" => <<~MDL
        create export mapping CRM.CustomerExport
          with json structure CRM.CustomerJson
        {
          CRM.Customer {
            Name = CustomerName,
            Email = EmailAddress
          }
        };
      MDL
    )
    layout = MendixBridge::DocumentParser.parse(
      "layout",
      "mdl" => <<~MDL
        -- Layout Type: Responsive
        -- Layouts cannot be created via MDL; they must be created in Studio Pro.
        -- layout CRM.Main
      MDL
    )
    navigation = MendixBridge::DocumentParser.parse(
      "navprofile",
      "mdl" => <<~MDL
        -- navigation PROFILE: Responsive
        --   Kind: Responsive
        create or replace navigation Responsive
          home page CRM.Home
          menu (
            menu item 'Home' page CRM.Home;
            menu item 'Refresh' nanoflow CRM.ACT_Refresh;
          )
        ;
      MDL
    )

    assert_equal "export", mapping["direction"]
    assert_equal "CRM.CustomerJson", mapping["structure"]
    assert_equal ["CRM.Customer"], mapping["entities"]
    assert_equal(
      { "attribute" => "Name", "member" => "CustomerName" },
      mapping["attribute_mappings"].first
    )
    assert_equal "Responsive", layout["layout_type"]
    assert_equal true, layout["studio_pro_only"]
    assert_equal "CRM.Home", navigation["home_page"]
    assert_equal "CRM.ACT_Refresh", navigation.dig("menu_items", 1, "target")

    imported = MendixBridge::DocumentParser.parse(
      "importmapping",
      "mdl" => <<~MDL
        create import mapping CRM.CustomerImport
          with json structure CRM.CustomerJson
        {
          create CRM.Customer {
            Name = CustomerName
          }
        };
      MDL
    )
    assert_equal ["CRM.Customer"], imported["entities"]
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

  def test_plans_enumeration_creation_changes_and_removals
    inventory = MendixBridge::Inventory.new(
      [
        {
          "label" => "CRM",
          "type" => "module",
          "qualifiedName" => "CRM",
          "children" => [
            {
              "label" => "Status",
              "type" => "enumeration",
              "qualifiedName" => "CRM.Status"
            }
          ]
        }
      ],
      details: {
        "CRM.Status" => {
          "parse_status" => "parsed",
          "values" => [
            { "name" => "Active", "caption" => "Active" },
            { "name" => "Legacy", "caption" => "Legacy" }
          ]
        }
      }
    )
    model = MendixBridge.app("Example") do
      modulo "CRM" do
        enumeration "Status" do
          value "Active", caption: "Currently active"
        end
        enumeration "Priority" do
          value "High"
        end
      end
    end

    operations = MendixBridge::ChangePlanner.plan(model, inventory)
      .operations.to_h { |operation| [operation.name, operation] }

    assert_equal "blocked", operations.fetch("CRM.Status").action
    assert_equal ["Legacy"], operations.fetch("CRM.Status").changes["removed_values"]
    assert_equal "create", operations.fetch("CRM.Priority").action
  end
end
