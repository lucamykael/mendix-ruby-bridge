# Mendix Bridge — Web frontend

React + Vite SPA for exploring (and, later, editing) an imported Mendix model.
It reads the inventory produced by `mendix-ruby import` and renders it with an
interactive, node-based canvas.

## Status (phase 1 — read-only)

- **Tree** of modules → folders → elements, with filter and a "Pages" toggle.
- **Interactive canvas** ([React Flow](https://reactflow.dev)) — nodes are
  draggable (the basis for the block-editing workflow):
  - microflows / nanoflows as a **flowchart** parsed from the MDL
    (`@position`/`@caption` + `if/else` → nodes and `true`/`false` edges);
  - entities as a **domain (ER) neighbourhood** (centre entity + directly
    associated entities); neighbours are clickable to navigate.
- **Detail panel** with the element's fields, tables and original MDL.

Parsing/model logic lives in `src/model/` (`flow.ts`, `er.ts`, `types.ts`),
decoupled from the UI so it can be reused when the backend round-trips edits
back into the model/code.

## Run (dev)

The app fetches the inventory from `/inventory/*.json`. For now that data is
served statically from `public/inventory/` (git-ignored). Populate it from an
imported project, e.g.:

```sh
cp ../ruby-bridge-sandbox-inventory/inventory/*.json public/inventory/
cp ../ruby-bridge-sandbox-inventory/mendix-project.json public/inventory/
npm install
npm run dev
```

Later this becomes an HTTP API served by the Ruby bridge, so drag-and-drop and
edits persist back to the `.mpr` via the existing plan/apply pipeline.

## Roadmap

1. Read-only explorer (this). 2. Marketplace browse (`mxcli marketplace`).
3. Drag-and-drop + write-back (`@position`/edits → MDL apply). 4. Page layout
preview and deeper editing.
