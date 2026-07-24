# Ruby DSL guide

## Model basics

```ruby
model = MendixBridge.app("Customer Portal", version: "1.0") do
  modulo "CRM" do
    entity "Customer" do
      attribute "Name", :string, required: true
      attribute "Active", :boolean, default: true
      association "Customer_Orders",
        target: "Sales.Order",
        cardinality: :many
    end
  end
end
```

The resulting hash is the versioned intermediate model consumed by the future
Mendix adapter:

```ruby
JSON.pretty_generate(model.to_h)
```

Supported attribute types in the initial domain-model scope are:
`autonumber`, `binary`, `boolean`, `datetime`, `decimal`, `enumeration`,
`hash_string`, `integer`, `long`, and `string`.

Strings use `length: 200` by default and accept `length: nil` for unlimited
text. Enumerations require their qualified Mendix name:

```ruby
attribute "Status",
  :enumeration,
  enumeration: "CRM.CustomerStatus",
  default: "Active"
```

## Compiling and applying

```sh
ruby examples/customer_app.rb
```

Compile a DSL file into the intermediate JSON:

```sh
bin/mendix-ruby compile examples/customer_app.rb
bin/mendix-ruby compile examples/customer_app.rb -o app-model.json
```

Generate idempotent MDL for `mxcli`:

```sh
bin/setup-tools
bin/mendix-ruby compile examples/customer_app.rb --format mdl
bin/mendix-ruby compile examples/customer_app.rb --format mdl -o customer-app.mdl
bin/mxcli check customer-app.mdl
bin/mxcli exec customer-app.mdl -p /path/to/App.mpr
```

Apply a DSL file with all safety checks:

```sh
bin/mendix-apply examples/sandbox_app.rb \
  --project ../mendix-ruby-sandbox/RubyBridgeSandbox.mpr
```

The target project must be in a clean Git repository and contain a
`.mendix-version` file matching the installed MxBuild version. The command
validates the generated MDL, applies it with the pinned `mxcli`, and runs the
official `mx check` afterward.

The target modules must already exist in the Mendix project. An association
declared inside an entity represents a reference from that entity to its target:
`:one` generates `Reference`, while `:many` generates `ReferenceSet`.

Define enumerations in the same module:

```ruby
enumeration "CustomerStatus", folder: "Domain/Enums" do
  value "Active"
  value "Waiting", caption: "Waiting for customer"
end
```

Enumeration creation and safe modifications participate in `plan` and `apply`.
Removing an existing value remains blocked until explicit migration support is
available.

Microflows support typed parameters, return types, folders, executable body
statements, and execute roles:

```ruby
microflow "ACT_Save", returns: "Boolean", folder: "Actions" do
  parameter "Customer", "CRM.Customer"
  body <<~MDL
    $Valid = call microflow CRM.SUB_Validate(Customer = $Customer);
    return $Valid;
  MDL
  execute_role "CRM.User"
end
```

The planner compares parsed flow semantics before applying changes.

Pages support title, layout, folder, typed parameters, widget MDL, and view
roles:

```ruby
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
```

Page changes are compared through the same semantic parser used by imports.

Security is declared at application, module, and entity levels:

```ruby
project_security level: :production, demo_users: false
user_role "Support", module_roles: ["CRM.Support"]

modulo "CRM" do
  module_role "Support", description: "Customer support"

  entity "Customer" do
    attribute "Name", :string
    access "CRM.Support",
      create: true,
      read: :all,
      write: ["Name"],
      where: "[Owner = '[%CurrentUser%]']"
  end
end
```

Existing role modifications and implicit access-rule removals remain blocked
until explicit `ALTER` and `REVOKE` migrations are available.

Navigation profiles support default and role-specific home pages, login and
not-found pages, direct menu items, and grouped menus:

```ruby
navigation_profile "Responsive",
  home_page: "CRM.Home",
  login_page: "CRM.Login" do
  home_page "CRM.AdminHome", for_role: "CRM.Admin"
  menu_item "Home", page: "CRM.Home"
  menu "Customers" do
    menu_item "Overview", page: "CRM.Customer_Overview"
    menu_item "Refresh", nanoflow: "CRM.ACT_Refresh"
  end
end
```

Navigation uses `CREATE OR REPLACE` and participates in semantic plan/apply.
