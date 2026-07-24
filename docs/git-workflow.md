# Git-controlled Mendix branches

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
