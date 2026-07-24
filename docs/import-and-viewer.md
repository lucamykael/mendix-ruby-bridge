# Import an existing Mendix project

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

Explore an imported inventory in the integrated web viewer:

```sh
bin/mendix-ruby serve ../ruby-bridge-sandbox-inventory
```

Open `http://127.0.0.1:4567`. The Ruby server exposes the inventory, dependency
graph, backend health, read-only Marketplace queries, and persisted canvas
positions. Layout positions live in `inventory/ui-layouts.json`; they do not
modify the source `.mpr`. Marketplace installation is intentionally disabled
in the viewer and remains available through the guarded CLI/Git workflow.

For parsed entities, choose **Edit entity** to create a visual draft. The editor
supports entity persistence plus adding or changing attributes and sends the
desired state to `POST /api/entity-plan`. Ruby validates it with the same change
planner used by the CLI, returns `keep`, `modify`, or `blocked`, and stores the
reviewable draft in `inventory/visual-plans.json`. This preview never modifies
the source `.mpr`; destructive or migration-sensitive changes remain blocked.

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
