// Loads the read-only model inventory and viewer-side layouts from the Ruby backend.

import type {
  BackendHealth,
  DependencyGraph,
  ElementDetail,
  Inventory,
  NodePosition,
  ProjectMeta,
  TreeNode,
} from "./types";

const BASE = "/inventory";

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} — ${url}`);
  return response.json() as Promise<T>;
}

export async function loadInventory(): Promise<Inventory> {
  const [tree, details, meta, dependencies, layouts] = await Promise.all([
    json<TreeNode[]>(`${BASE}/project-tree.json`),
    json<Record<string, ElementDetail>>(`${BASE}/element-details.json`),
    json<ProjectMeta>(`${BASE}/mendix-project.json`).catch(() => ({})),
    json<DependencyGraph>(`${BASE}/dependencies.json`).catch(() => ({
      schema_version: 1,
      nodes: 0,
      edges: [],
    })),
    json<Record<string, NodePosition[]>>(`${BASE}/ui-layouts.json`).catch(() => ({})),
  ]);
  return { tree, details, meta, dependencies, layouts };
}

export function loadHealth(): Promise<BackendHealth> {
  return json<BackendHealth>("/api/health");
}
