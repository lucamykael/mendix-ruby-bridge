# Mendix Ruby Bridge

Ruby DSL for describing Mendix application models.

## Installation

Install the gem and its pinned `mxcli` tool:

```sh
gem install mendix-ruby-bridge
mendix-ruby setup
```

The tool cache lives under the user's data directory for gem installations.
Source checkouts continue using the repository-local `.tools/` directory. Set
`MENDIX_RUBY_TOOLS_DIR` to override either location.

Run the backend test suite and build the package:

```sh
bundle install
bundle exec rake test
bundle exec rake build
```

Tags matching the gem version, such as `v0.1.0`, run the complete test matrix,
build the gem, and publish it as a GitHub Release. Creating a tag remains an
explicit release action.

## Create a Mendix project from Ruby

Create a new `.mpr`, apply the complete Ruby model, run the official Mendix
consistency check, and initialize a clean Git repository:

```sh
bin/mendix-ruby new examples/customer_app.rb \
  --output ../customer-app \
  --version 11.6.8
```

The command creates missing modules, stores the source model as `app.rb`, writes
`.mendix-version` and `.gitignore`, and commits the validated result as
`Initial Setup` on `main`. Use `--no-git` when another tool will initialize
version control.

The output directory must not exist. A failed creation is left in place for
diagnosis and is never silently deleted.

## Project configuration

Store the frequently used paths once:

```sh
bin/mendix-ruby configure \
  --project ../mendix-app/App.mpr \
  --inventory ../ruby-inventory \
  --model app.rb
```

This writes `.mendix-ruby.yml` with paths relative to the configuration file.
The CLI discovers it from the current directory or any parent. Explicit command
arguments always take priority.

With configuration present, common commands become:

```sh
bin/mendix-ruby import --force
bin/mendix-ruby compile --format mdl
bin/mendix-ruby plan
bin/mendix-ruby deps CRM.Customer --direction impact
bin/mendix-apply
```

## Explicit migrations and rollback

Destructive changes live in a separate migration file:

```ruby
require "mendix_bridge"

MendixBridge.migration("remove-legacy-customer-data") do
  rename :entity, "CRM.Customer", to: "Client"
  rename_attribute "CRM.Client", "Email", to: "EmailAddress"
  drop_attribute "CRM.Client", "Legacy"
  rename_enumeration_value "CRM.Status", "Waiting", to: "Pending"
  drop_enumeration_value "CRM.Status", "Obsolete"
  revoke_access "CRM.Client", role: "CRM.LegacyUser"
  drop :microflow, "CRM.ACT_Legacy"
end
```

Preview without changing the project:

```sh
bin/mendix-ruby migrate migration.rb --project App.mpr --dry-run
```

Applying requires a clean Git repository, Studio Pro confirmation, and the
exact migration name:

```sh
bin/mendix-ruby migrate migration.rb \
  --project App.mpr \
  --confirm remove-legacy-customer-data \
  --studio-closed
```

Before mutation, the bridge stores the `.mpr`, `mprcontents`, and a manifest
under Git's private metadata directory. Any failed Mendix consistency check
automatically restores that backup. A successful migration prints the backup
path for explicit rollback:

```sh
bin/mendix-ruby rollback /path/to/backup \
  --project App.mpr \
  --confirm BACKUP_DIRECTORY_NAME \
  --studio-closed
```

## Run the example

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

## Git-controlled Mendix branches

Keep Studio Pro closed during branch transitions and use Git as the source of
truth. When `bin/` is on `PATH`, Git discovers `git-mendix` as a subcommand.
Run these from the Mendix project directory (the single `.mpr` is detected):

```sh
git mendix status

git mendix branches --fetch

git mendix new feature/customer-import \
  --inventory ../ruby-bridge-sandbox-inventory \
  --studio-closed

git mendix switch main \
  --inventory ../ruby-bridge-sandbox-inventory \
  --studio-closed
```

Use `mendix-git` directly when `git-mendix` is not installed on `PATH`, and
pass `--project APP.mpr` when running outside the project directory.

`switch` and `new` refuse dirty working trees and in-progress Git operations.
They require explicit confirmation that Studio Pro is closed, run the official
Mendix consistency check after switching, and refresh the Ruby inventory when
`--inventory` is provided. If validation fails, the command attempts to return
to the previous branch.

Stash operations preserve Mendix validation:

```sh
git mendix stash push -m "Work in progress" --include-untracked --studio-closed
git mendix stash list
git mendix stash show
git mendix stash apply --studio-closed
git mendix stash pop --studio-closed
git mendix stash drop
```

`pop` is implemented as apply, consistency check, optional inventory refresh,
then drop. A conflict or failed Mendix check leaves the stash intact.

Merge and rebase are also guarded:

```sh
git mendix merge feature/customer-import --studio-closed
git mendix rebase main --studio-closed
```

Merge is held before its commit until `mx check` succeeds. Rebase validates the
project during the rebase so failures can be resolved or aborted with standard
Git commands.

## Import an existing Mendix project

Create a read-only Ruby inventory from an existing `.mpr`:

```sh
bin/mendix-ruby import ../mendix-ruby-sandbox/RubyBridgeSandbox.mpr \
  --output ../ruby-bridge-sandbox-inventory
```

The generated directory contains the complete JSON tree exposed by `mxcli`,
semantic domain details, generated Ruby files per module, import metadata, and
a `Mendixfile.rb` that loads a searchable Ruby API:

```ruby
require_relative "Mendixfile"

project = MENDIX_PROJECT
project.modules
project.of_type("entity")
project.of_type("microflow")
project.search("Customer")
project.find("MyFirstModule.Customer")
project.types
```

Entity details include persistence, generalization, attributes, types,
required/default values, and the original MDL. Association details include
source, target, reference type, owner, storage, delete behavior, and original
MDL. Microflow details include parameters, return type, folder, activities,
called microflows, execute roles, and original MDL. Nanoflow details additionally
identify calls to nanoflows and JavaScript actions. Enumeration details include
their values, captions, and folder. Generated files live under
`generated/modules/`, `generated/microflows/`, `generated/nanoflows/`, and
`generated/enumerations/`. Page details include title, layout, parameters,
widgets, data sources, attributes, actions, linked microflows/pages, view roles,
and original MDL; generated page files live under `generated/pages/`.

Constants expose type, default, and folder. Java actions expose parameters,
return type, and source availability. Import/export mappings expose their
structure, entities, and attribute mappings. Layouts, snippets, and navigation
profiles also receive normalized details. Their generated Ruby inventories live
under corresponding directories in `generated/`.

Security details include project settings, user-role to module-role mappings,
role-management permissions, module-role membership, and entity access rules
for create/delete/read/write plus XPath constraints. The consolidated security
view lives under `generated/security/`.

Refresh an existing inventory with `--force`. Importing is read-only and never
modifies the source `.mpr`. The raw tree preserves every element reported by
`mxcli`, including types that the bridge does not yet interpret semantically.

After the initial import, refresh from the imported project directory:

```sh
bin/mendix-ruby refresh ../ruby-bridge-sandbox-inventory
```

The command reads the source path from `mendix-project.json`, reports added,
modified, and removed elements, and writes `changes/latest.json`. It replaces
only snapshots and files under `generated/`; existing scaffold and manual files
outside `generated/` are preserved.

Every import also writes `inventory/dependencies.json`. It combines normalized
semantic references with qualified MDL references and retains only targets that
exist in the inventory.

Query dependencies, dependents, callers, callees, and downstream impact:

```sh
bin/mendix-ruby deps CRM.ACT_Save ../ruby-bridge-sandbox-inventory
bin/mendix-ruby deps CRM.ACT_Save ../ruby-bridge-sandbox-inventory \
  --direction callees
bin/mendix-ruby deps CRM.Customer ../ruby-bridge-sandbox-inventory \
  --direction impact --json
```

Use `--transitive` to walk the complete graph. Impact is always transitive and
reports every downstream reference path and kind.

Search and inspect from the terminal:

```sh
bin/mendix-ruby search Customer ../ruby-bridge-sandbox-inventory
bin/mendix-ruby search Customer ../ruby-bridge-sandbox-inventory --type entity
bin/mendix-ruby inspect MyFirstModule.Customer ../ruby-bridge-sandbox-inventory
bin/mendix-ruby inspect MyFirstModule.Customer ../ruby-bridge-sandbox-inventory --json
bin/mendix-ruby inspect MyFirstModule.Customer ../ruby-bridge-sandbox-inventory --mdl
bin/mendix-ruby inspect Atlas_Web_Content.Phone_Form ../ruby-bridge-sandbox-inventory --type page
```

Preview a Ruby DSL change against an imported snapshot:

```sh
bin/mendix-ruby plan examples/sandbox_app.rb \
  --inventory ../ruby-bridge-sandbox-inventory
```

Use `--json` for automation. Undeclared Mendix elements are preserved. Implicit
attribute removals, missing modules, unparsed entities, and changes to existing
associations are reported as `BLOCKED`; a blocked plan exits with status 2.

## DSL

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
