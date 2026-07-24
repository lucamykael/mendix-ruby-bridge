// Loads the imported inventory. For now it reads the static JSON copied into
// /public/inventory; later this becomes an HTTP API served by the Ruby bridge,
// so writes (drag-and-drop, edits) round-trip back into the model/code.

import type { Inventory, ElementDetail, ProjectMeta, TreeNode } from "./types";

const BASE = "/inventory";

export async function loadInventory(): Promise<Inventory> {
  const [tree, details, meta] = await Promise.all([
    fetch(`${BASE}/project-tree.json`).then((r) => r.json() as Promise<TreeNode[]>),
    fetch(`${BASE}/element-details.json`).then((r) => r.json() as Promise<Record<string, ElementDetail>>),
    fetch(`${BASE}/mendix-project.json`)
      .then((r) => r.json() as Promise<ProjectMeta>)
      .catch(() => ({}) as ProjectMeta),
  ]);
  return { tree, details, meta };
}
