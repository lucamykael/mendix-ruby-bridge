# Mendix Ruby Bridge

Ruby DSL for describing Mendix application models: create projects from Ruby,
import existing `.mpr` projects into a searchable Ruby inventory, plan and
apply changes safely, and explore everything in an integrated web viewer.

## Installation

Install the gem and its pinned `mxcli` tool:

```sh
gem install mendix-ruby-bridge
mendix-ruby setup
```

## Quick start

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

```sh
# Create a new Mendix project from a Ruby model
bin/mendix-ruby new examples/customer_app.rb --output ../customer-app --version 11.6.8

# Import an existing project into a Ruby inventory and explore it
bin/mendix-ruby import ../app/App.mpr --output ../ruby-inventory
bin/mendix-ruby serve ../ruby-inventory   # http://127.0.0.1:4567

# Preview and apply declarative changes with all safety checks
bin/mendix-ruby plan examples/sandbox_app.rb --inventory ../ruby-inventory
bin/mendix-apply examples/sandbox_app.rb --project ../app/App.mpr
```

## Documentation

- [Getting started](docs/getting-started.md) — installation, creating a
  project from Ruby, and project configuration.
- [Ruby DSL guide](docs/dsl.md) — entities, enumerations, microflows, pages,
  security, navigation, and compiling/applying models.
- [Explicit migrations and rollback](docs/migrations.md) — destructive and
  security-sensitive changes (renames, drops, role changes) with backup and
  rollback.
- [Git-controlled Mendix branches](docs/git-workflow.md) — guarded branch
  switching, stash, merge, and rebase with Mendix consistency checks.
- [Import and the web viewer](docs/import-and-viewer.md) — importing existing
  projects, dependency queries, search/inspect, and the integrated viewer
  (domain explorer, ER diagram, page builder, Git panel, Marketplace).

## Safety model

The declarative apply is additive and idempotent; destructive or
migration-sensitive changes are reported as `BLOCKED` and belong in explicit
migrations. The web viewer never writes the `.mpr`: visual edits are validated
with `mxcli check` and stored as reviewable drafts, while real writes go
through the guarded CLI/Git workflow with Studio Pro closed.

## Development

```sh
bundle install
bundle exec rake test
bundle exec rake build
```

Tags matching the gem version, such as `v0.1.0`, run the complete test matrix,
build the gem, and publish it as a GitHub Release.
