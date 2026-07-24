// Build a full entity-relationship diagram (dbdiagram.io style) from the imported
// inventory: every entity becomes a table card, every association a relationship
// line. Scope is the whole project, filterable by module.

import type { Edge, Node } from "@xyflow/react";
import type { Assoc } from "./er";
import type { Attribute, ElementDetail, TreeNode } from "./types";

export interface ErRef {
  qn: string; // association QN
  targetQn: string; // entity this reference points to
  targetName: string;
  many: boolean; // ReferenceSet -> true
}

export interface ErTableData extends Record<string, unknown> {
  qn: string;
  name: string;
  module: string;
  generalization?: string;
  persistable: boolean;
  attributes: Attribute[];
  refs: ErRef[];
}

const TABLE_WIDTH = 240;
const HEADER_H = 44;
const ROW_H = 24;
const GAP = 42;
const COLUMNS = 4;

function shortName(qn: string): string {
  return qn.split(".").pop() ?? qn;
}

// All module names in the project, sorted — drives the module picker.
export function listErModules(tree: TreeNode[]): string[] {
  return tree.filter((n) => n.type === "module").map((n) => n.label).sort();
}

// Collect entity QNs (with their module) from the authoritative tree.
function collectEntities(tree: TreeNode[]): { qn: string; module: string }[] {
  const out: { qn: string; module: string }[] = [];
  for (const mod of tree) {
    if (mod.type !== "module") continue;
    const walk = (nodes: TreeNode[] | undefined) => {
      for (const n of nodes ?? []) {
        if (n.type === "entity" && n.qualifiedName) {
          out.push({ qn: n.qualifiedName, module: mod.label });
        }
        walk(n.children);
      }
    };
    walk(mod.children);
  }
  return out;
}

function estimatedHeight(data: ErTableData): number {
  return HEADER_H + (data.attributes.length + data.refs.length) * ROW_H + 12;
}

export function buildErDiagram(
  tree: TreeNode[],
  details: Record<string, ElementDetail>,
  assocs: Assoc[],
  selectedModules: Set<string>,
): { nodes: Node<ErTableData>[]; edges: Edge[]; modules: string[] } {
  const entities = collectEntities(tree);
  const modules = [...new Set(entities.map((e) => e.module))].sort();

  const visible = entities.filter((e) => selectedModules.has(e.module));
  const visibleQns = new Set(visible.map((e) => e.qn));

  // References that originate from a visible entity toward another visible one.
  const refsByOwner = new Map<string, ErRef[]>();
  for (const a of assocs) {
    if (!visibleQns.has(a.from) || !visibleQns.has(a.to)) continue;
    const list = refsByOwner.get(a.from) ?? [];
    list.push({
      qn: a.qn,
      targetQn: a.to,
      targetName: shortName(a.to),
      many: a.type === "ReferenceSet",
    });
    refsByOwner.set(a.from, list);
  }

  const columnY = new Array(COLUMNS).fill(20);
  const nodes: Node<ErTableData>[] = visible.map((e, index) => {
    const detail = details[e.qn];
    const data: ErTableData = {
      qn: e.qn,
      name: shortName(e.qn),
      module: e.module,
      generalization: detail?.generalization,
      persistable: detail?.persistable !== false,
      attributes: Array.isArray(detail?.attributes) ? detail!.attributes! : [],
      refs: refsByOwner.get(e.qn) ?? [],
    };
    const col = index % COLUMNS;
    const x = 20 + col * (TABLE_WIDTH + GAP);
    const y = columnY[col];
    columnY[col] = y + estimatedHeight(data) + GAP;
    return { id: e.qn, type: "erTable", position: { x, y }, data };
  });

  const edges: Edge[] = [];
  for (const a of assocs) {
    if (!visibleQns.has(a.from) || !visibleQns.has(a.to)) continue;
    const many = a.type === "ReferenceSet";
    edges.push({
      id: a.qn,
      source: a.from,
      target: a.to,
      sourceHandle: `ref-${a.qn}`,
      label: many ? "*  —  *" : "*  —  1",
      style: { stroke: "var(--edge)", strokeWidth: 1.5 },
      labelStyle: { fill: "var(--muted)", fontSize: 10 },
      labelBgStyle: { fill: "var(--panel)", fillOpacity: 0.85 },
    });
  }

  return { nodes, edges, modules };
}
