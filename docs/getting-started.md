# Getting started

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
