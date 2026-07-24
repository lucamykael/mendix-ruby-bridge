# Mendix Ruby Bridge

Ruby DSL for describing Mendix application models.

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
