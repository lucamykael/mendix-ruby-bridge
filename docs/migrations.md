# Explicit migrations and rollback

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
  alter_module_role "CRM.Support", description: "Customer support"
  alter_user_role "Support", module_roles: ["CRM.Support", "CRM.Admin"]
  drop :microflow, "CRM.ACT_Legacy"
end
```

Altering an existing user or module role is a security change, so it also lives
in a migration rather than the declarative apply, which blocks it on purpose.

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
