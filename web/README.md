# Mendix Bridge — Web frontend

React + Vite SPA for exploring an imported Mendix model.
It reads the inventory produced by `mendix-ruby import` and renders it with an
interactive, node-based canvas.

## Backend integration

- **Tree** of modules → folders → elements, with filter and a "Pages" toggle.
- **Interactive canvas** ([React Flow](https://reactflow.dev)) — nodes are
  draggable (the basis for the block-editing workflow):
  - microflows / nanoflows as a **flowchart** parsed from the MDL
    (`@position`/`@caption` + `if/else` → nodes and `true`/`false` edges);
  - entities as a **domain (ER) neighbourhood** (centre entity + directly
    associated entities); neighbours are clickable to navigate.
- **Detail panel** with the element's fields, tables and original MDL.
- **Dependency navigation** from `inventory/dependencies.json`.
- **Persisted canvas positions** in the Ruby inventory sidecar
  `inventory/ui-layouts.json`. This does not modify the source `.mpr`.
- **Marketplace browsing** through `mxcli`. Installation remains disabled in
  the viewer and must use the guarded CLI/Git workflow.

Parsing/model logic lives in `src/model/` (`flow.ts`, `er.ts`, `types.ts`),
decoupled from the UI so it can be reused when the backend round-trips edits
back into the model/code.

## Run

Build the frontend and start the integrated Ruby server:

```sh
npm ci
npm run build
cd ..
bin/mendix-ruby serve ../ruby-bridge-sandbox-inventory
```

Open `http://127.0.0.1:4567`. During frontend development, keep the Ruby server
running and start Vite in another terminal:

```sh
bin/mendix-ruby serve ../ruby-bridge-sandbox-inventory
cd web
npm ci
npm run dev
```

Vite proxies `/inventory` and `/api` to `http://127.0.0.1:4567`. Override that
target with `VITE_BACKEND_URL`.
