# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/mendix_bridge"

class MdlParserTest < Minitest::Test
  include MendixBridge

  # ---------------------------------------------------------------------------
  # parse_page_widgets — full MDL input
  # ---------------------------------------------------------------------------

  def test_parses_single_textbox
    mdl = <<~MDL
      CREATE OR MODIFY PAGE CRM.Edit (Title: 'Edit') {
        textbox tbName (Label: 'Name', Attribute: Name)
      }
    MDL
    tree = MdlParser.parse_page_widgets(mdl)
    assert_equal 1, tree.size
    node = tree.first
    assert_equal "textbox", node["type"]
    assert_equal "tbName",  node["name"]
    assert_equal "Name",    node.dig("properties", "Label")
    assert_equal "Name",    node.dig("properties", "Attribute")
    assert_empty node["children"]
  end

  def test_parses_dataview_with_nested_widgets
    mdl = <<~MDL
      CREATE OR MODIFY PAGE CRM.Edit (Title: 'Edit', Layout: Atlas_Core.Atlas_Default) {
        dataview dv1 (DataSource: $Customer) {
          textbox tbName  (Label: 'Name',  Attribute: Name)
          textbox tbEmail (Label: 'Email', Attribute: Email)
          footer ftr1 () {
            actionbutton btnSave   (Caption: 'Save',   Action: save_changes,   ButtonStyle: Success)
            actionbutton btnCancel (Caption: 'Cancel', Action: cancel_changes, ButtonStyle: Default)
          }
        }
      }
    MDL
    tree = MdlParser.parse_page_widgets(mdl)
    assert_equal 1, tree.size

    dv = tree.first
    assert_equal "dataview",    dv["type"]
    assert_equal "dv1",         dv["name"]
    assert_equal "$Customer",   dv.dig("properties", "DataSource")
    assert_equal 3,             dv["children"].size

    footer = dv["children"].last
    assert_equal "footer", footer["type"]
    assert_equal 2,        footer["children"].size
    assert_equal "btnSave",   footer["children"][0]["name"]
    assert_equal "btnCancel", footer["children"][1]["name"]
  end

  def test_parses_layoutgrid_with_column_widths
    mdl = <<~MDL
      CREATE OR MODIFY PAGE CRM.Overview (Title: 'Overview') {
        layoutgrid lg1 () {
          row r1 () {
            column cLeft  (DesktopWidth: 6) {
              textbox tbA (Label: 'A', Attribute: A)
            }
            column cRight (DesktopWidth: 6) {
              textbox tbB (Label: 'B', Attribute: B)
            }
          }
        }
      }
    MDL
    tree = MdlParser.parse_page_widgets(mdl)
    assert_equal 1, tree.size
    lg = tree.first
    assert_equal "layoutgrid", lg["type"]
    row  = lg["children"].first
    assert_equal "row", row["type"]
    cols = row["children"]
    assert_equal 2, cols.size
    assert_equal 6, cols[0].dig("properties", "DesktopWidth")
    assert_equal 6, cols[1].dig("properties", "DesktopWidth")
  end

  def test_parses_microflow_action_property
    mdl = <<~MDL
      CREATE OR MODIFY PAGE CRM.Edit (Title: 'Edit') {
        actionbutton btnAct (
          Caption: 'Execute',
          Action: microflow CRM.ACT_DoSomething($Obj: $currentObject),
          ButtonStyle: Primary
        )
      }
    MDL
    tree = MdlParser.parse_page_widgets(mdl)
    btn  = tree.first
    assert_equal "actionbutton", btn["type"]
    assert_match(/\Amicroflow CRM\.ACT_DoSomething/, btn.dig("properties", "Action").to_s)
  end

  def test_parses_database_datasource
    mdl = <<~MDL
      CREATE OR MODIFY PAGE CRM.List (Title: 'List') {
        listview lv1 (DataSource: database CRM.Customer) {
          textbox tbName (Attribute: Name)
        }
      }
    MDL
    tree = MdlParser.parse_page_widgets(mdl)
    lv   = tree.first
    assert_equal "listview",            lv["type"]
    assert_equal "database CRM.Customer", lv.dig("properties", "DataSource")
  end

  def test_parses_quoted_strings_with_escaped_quotes
    mdl = <<~MDL
      CREATE OR MODIFY PAGE CRM.Edit (Title: 'It''s a Test') {
        dynamictext dt1 (Content: 'Hello ''World''')
      }
    MDL
    tree = MdlParser.parse_page_widgets(mdl)
    node = tree.first
    assert_equal "dynamictext", node["type"]
    assert_equal "Hello 'World'", node.dig("properties", "Content")
  end

  def test_parses_multiple_top_level_widgets
    mdl = <<~MDL
      CREATE OR MODIFY PAGE CRM.Mix (Title: 'Mix') {
        container c1 (Class: 'header-section') {}
        listview lv1 (DataSource: database CRM.Customer) {}
        container c2 (Class: 'footer-section') {}
      }
    MDL
    tree = MdlParser.parse_page_widgets(mdl)
    assert_equal 3, tree.size
    assert_equal %w[container listview container], tree.map { |n| n["type"] }
  end

  def test_parses_tabcontainer_with_tabpages
    mdl = <<~MDL
      CREATE OR MODIFY PAGE CRM.Detail (Title: 'Detail') {
        tabcontainer tc1 () {
          tabpage tpGeneral (Caption: 'General') {
            textbox tbName (Label: 'Name', Attribute: Name)
          }
          tabpage tpContacts (Caption: 'Contacts', IsDefault: true) {
            listview lvContacts (DataSource: association $Customer/CRM.Customer_Contacts) {}
          }
        }
      }
    MDL
    tree = MdlParser.parse_page_widgets(mdl)
    tc   = tree.first
    assert_equal "tabcontainer", tc["type"]
    assert_equal 2, tc["children"].size
    assert_equal "tpGeneral",  tc["children"][0]["name"]
    assert_equal "tpContacts", tc["children"][1]["name"]
    assert_equal true, tc.dig("children", 1, "properties", "IsDefault")
  end

  # ---------------------------------------------------------------------------
  # flat_widget_names
  # ---------------------------------------------------------------------------

  def test_flat_widget_names_collects_all_named_widgets
    mdl = <<~MDL
      CREATE OR MODIFY PAGE CRM.Edit (Title: 'Edit') {
        dataview dv1 (DataSource: $Customer) {
          textbox tbName (Attribute: Name)
          footer ftr1 () {
            actionbutton btnSave (Caption: 'Save', Action: save_changes)
          }
        }
      }
    MDL
    tree  = MdlParser.parse_page_widgets(mdl)
    names = MdlParser.flat_widget_names(tree)
    assert_equal %w[dv1 tbName ftr1 btnSave], names
  end

  def test_flat_widget_names_skips_anonymous_widgets
    mdl = <<~MDL
      CREATE OR MODIFY PAGE CRM.Edit (Title: 'Edit') {
        dataview (DataSource: $Customer) {
          textbox tbNamed (Attribute: Name)
        }
      }
    MDL
    tree  = MdlParser.parse_page_widgets(mdl)
    names = MdlParser.flat_widget_names(tree)
    assert_includes names, "tbNamed"
    refute_includes names, nil
  end

  # ---------------------------------------------------------------------------
  # flat_widgets
  # ---------------------------------------------------------------------------

  def test_flat_widgets_returns_every_node
    mdl = <<~MDL
      CREATE OR MODIFY PAGE CRM.Edit (Title: 'Edit') {
        layoutgrid lg1 () {
          row r1 () {
            column col1 (DesktopWidth: 12) {
              textbox tbName (Attribute: Name)
            }
          }
        }
      }
    MDL
    tree = MdlParser.parse_page_widgets(mdl)
    all  = MdlParser.flat_widgets(tree)
    types = all.map { |n| n["type"] }
    assert_equal %w[layoutgrid row column textbox], types
  end

  # ---------------------------------------------------------------------------
  # parse_widget_tree — body-only input
  # ---------------------------------------------------------------------------

  def test_parse_widget_tree_on_bare_body
    body = <<~MDL
      textbox tb1 (Label: 'X', Attribute: X)
      checkbox cb1 (Label: 'Active', Attribute: IsActive)
    MDL
    tree = MdlParser.parse_widget_tree(body)
    assert_equal 2, tree.size
    assert_equal "textbox",  tree[0]["type"]
    assert_equal "checkbox", tree[1]["type"]
  end

  def test_ignores_comments_in_body
    body = <<~MDL
      -- This is a comment
      textbox tbName (Label: 'Name', Attribute: Name)
      -- another comment
      checkbox cbActive (Label: 'Active', Attribute: IsActive)
    MDL
    tree = MdlParser.parse_widget_tree(body)
    assert_equal 2, tree.size
  end

  def test_handles_expression_property_in_brackets
    mdl = <<~MDL
      CREATE OR MODIFY PAGE CRM.Edit (Title: 'Edit') {
        textbox tbName (
          Label: 'Name',
          Attribute: Name,
          Visible: [$currentObject/IsActive = true],
          Editable: [$currentObject/Role = 'admin']
        )
      }
    MDL
    tree = MdlParser.parse_page_widgets(mdl)
    node = tree.first
    assert_match(/\$currentObject\/IsActive/, node.dig("properties", "Visible").to_s)
    assert_match(/\$currentObject\/Role/,     node.dig("properties", "Editable").to_s)
  end

  def test_handles_association_datasource
    mdl = <<~MDL
      CREATE OR MODIFY PAGE CRM.Edit (Title: 'Edit') {
        dataview dvOrders (DataSource: $Customer/CRM.Customer_Orders) {
          textbox tbTotal (Attribute: TotalAmount)
        }
      }
    MDL
    tree = MdlParser.parse_page_widgets(mdl)
    dv   = tree.first
    assert_match(/\$Customer\/CRM\.Customer_Orders/, dv.dig("properties", "DataSource").to_s)
  end

  def test_handles_numeric_properties
    mdl = <<~MDL
      CREATE OR MODIFY PAGE CRM.List (Title: 'List', PopupWidth: 800, PopupHeight: 600) {
        datagrid dg1 (PageSize: 20, DataSource: database CRM.Customer) {}
      }
    MDL
    tree = MdlParser.parse_page_widgets(mdl)
    dg   = tree.first
    assert_equal 20, dg.dig("properties", "PageSize")
  end
end

class AlterPageBuilderTest < Minitest::Test
  include MendixBridge

  def test_build_set_operation
    mdl = AlterPageBuilder.build(
      qn: "CRM.EditCustomer",
      operations: [
        { "op" => "set", "widget" => "btnSave",
          "props" => { "Caption" => "Save & Close", "ButtonStyle" => "Success" } }
      ]
    )
    assert_includes mdl, "ALTER PAGE CRM.EditCustomer"
    assert_includes mdl, "SET (Caption: 'Save & Close', ButtonStyle: Success) ON btnSave"
  end

  def test_build_insert_after
    mdl = AlterPageBuilder.build(
      qn: "CRM.EditCustomer",
      operations: [
        { "op" => "insert_after", "widget" => "tbEmail",
          "body" => "textbox tbPhone (Label: 'Phone', Attribute: Phone)" }
      ]
    )
    assert_includes mdl, "INSERT AFTER tbEmail"
    assert_includes mdl, "textbox tbPhone"
  end

  def test_build_insert_before
    mdl = AlterPageBuilder.build(
      qn: "CRM.EditCustomer",
      operations: [
        { "op" => "insert_before", "widget" => "btnCancel",
          "body" => "actionbutton btnDelete (Caption: 'Delete', Action: close_page)" }
      ]
    )
    assert_includes mdl, "INSERT BEFORE btnCancel"
    assert_includes mdl, "btnDelete"
  end

  def test_build_drop_widgets
    mdl = AlterPageBuilder.build(
      qn: "CRM.EditCustomer",
      operations: [
        { "op" => "drop", "widgets" => ["tbUnused", "lblOld"] }
      ]
    )
    assert_includes mdl, "DROP WIDGET tbUnused, lblOld"
  end

  def test_build_replace
    mdl = AlterPageBuilder.build(
      qn: "CRM.EditCustomer",
      operations: [
        { "op" => "replace", "widget" => "tbName",
          "body" => "textarea taName (Label: 'Name', Attribute: Name, NumberOfLines: 3)" }
      ]
    )
    assert_includes mdl, "REPLACE tbName WITH"
    assert_includes mdl, "textarea taName"
  end

  def test_build_set_layout
    mdl = AlterPageBuilder.build(
      qn: "CRM.EditCustomer",
      operations: [{ "op" => "set_layout", "layout" => "Atlas_Core.Atlas_Sidebar_Full" }]
    )
    assert_includes mdl, "SET Layout Atlas_Core.Atlas_Sidebar_Full"
  end

  def test_build_add_variable
    mdl = AlterPageBuilder.build(
      qn: "CRM.EditCustomer",
      operations: [{ "op" => "add_variable", "name" => "counter", "type" => "Integer", "default" => "0" }]
    )
    assert_includes mdl, "ADD VARIABLES $counter: Integer = '0'"
  end

  def test_build_drop_variable
    mdl = AlterPageBuilder.build(
      qn: "CRM.EditCustomer",
      operations: [{ "op" => "drop_variable", "name" => "counter" }]
    )
    assert_includes mdl, "DROP VARIABLES $counter"
  end

  def test_build_multiple_operations_in_order
    mdl = AlterPageBuilder.build(
      qn: "CRM.EditCustomer",
      operations: [
        { "op" => "set",  "widget" => "btnSave", "props" => { "Caption" => "OK" } },
        { "op" => "drop", "widgets" => ["tbUnused"] }
      ]
    )
    set_pos  = mdl.index("SET")
    drop_pos = mdl.index("DROP")
    assert set_pos < drop_pos, "SET should come before DROP"
  end

  def test_escape_single_quotes_in_string_props
    mdl = AlterPageBuilder.build(
      qn: "CRM.EditCustomer",
      operations: [
        { "op" => "set", "widget" => "lbl1", "props" => { "Caption" => "It's here" } }
      ]
    )
    assert_includes mdl, "Caption: 'It''s here'"
  end

  # ---------------------------------------------------------------------------
  # validate
  # ---------------------------------------------------------------------------

  def test_validate_rejects_unknown_op
    errors = AlterPageBuilder.validate([{ "op" => "explode", "widget" => "x" }])
    assert_any(errors) { |e| e.include?("unknown op") }
  end

  def test_validate_rejects_set_without_widget
    errors = AlterPageBuilder.validate([{ "op" => "set", "props" => { "Caption" => "X" } }])
    assert_any(errors) { |e| e.include?("'widget' required") }
  end

  def test_validate_rejects_set_without_props
    errors = AlterPageBuilder.validate([{ "op" => "set", "widget" => "btn1" }])
    assert_any(errors) { |e| e.include?("'props'") }
  end

  def test_validate_rejects_drop_without_widgets_array
    errors = AlterPageBuilder.validate([{ "op" => "drop", "widgets" => "btnSave" }])
    assert_any(errors) { |e| e.include?("array of strings") }
  end

  def test_validate_checks_widget_name_existence
    errors = AlterPageBuilder.validate(
      [{ "op" => "set", "widget" => "ghostWidget", "props" => { "Caption" => "X" } }],
      known_names: %w[tbName btnSave]
    )
    assert_any(errors) { |e| e.include?("ghostWidget") && e.include?("not found") }
  end

  def test_validate_passes_when_widget_exists
    errors = AlterPageBuilder.validate(
      [{ "op" => "set", "widget" => "btnSave", "props" => { "Caption" => "X" } }],
      known_names: %w[tbName btnSave]
    )
    assert_empty errors
  end

  def test_validate_invalid_layout_qn
    errors = AlterPageBuilder.validate([{ "op" => "set_layout", "layout" => "notAQualifiedName" }])
    assert_any(errors) { |e| e.include?("qualified name") }
  end

  def test_validate_empty_operations_array
    errors = AlterPageBuilder.validate([])
    assert_empty errors
  end

  def test_validate_rejects_non_array
    errors = AlterPageBuilder.validate("not an array")
    assert_any(errors) { |e| e.include?("array") }
  end

  private

  def assert_any(collection, &block)
    assert collection.any?(&block),
      "Expected at least one element to satisfy the block.\n  Got: #{collection.inspect}"
  end
end
