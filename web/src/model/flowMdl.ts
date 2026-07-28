// Serialize the flow canvas (nodes + edges) back into a microflow body: the
// inverse of parseFlow in flow.ts. Walks the graph from Start, re-emitting the
// original statements (kept in node data) with current @position/@caption
// annotations, and reconstructs if/else/end if from decision branches. New
// blocks without an original statement get a valid DECLARE placeholder.
// `mxcli check` on the backend is the real gate.

import type { Edge, Node } from "@xyflow/react";

interface FlowData {
  label?: string;
  kind?: string;
  stmt?: string | null;
}

interface Ctx {
  byId: Map<string, Node>;
  outs: Map<string, { target: string; label?: string }[]>;
  lines: string[];
  visited: Set<string>;
  synth: number;
}

const data = (node: Node): FlowData => node.data as FlowData;

function annotations(node: Node, ctx: Ctx, indent: string) {
  ctx.lines.push(`${indent}@position(${Math.round(node.position.x)}, ${Math.round(node.position.y)})`);
  const d = data(node);
  const label = (d.label ?? "").replace(/…$/, "");
  if (d.stmt && label && !d.stmt.startsWith(label)) {
    ctx.lines.push(`${indent}@caption '${label.replace(/'/g, "''")}'`);
  }
}

function statement(node: Node, ctx: Ctx): string {
  const d = data(node);
  // Guard against junk statements (e.g. comment fragments a stale parse turned
  // into nodes) — fall through to the DECLARE placeholder instead.
  const valid = d.stmt && /^[A-Za-z$]/.test(d.stmt.trim());
  if (d.stmt && valid) return d.stmt.endsWith(";") || node.type === "decision" ? d.stmt : `${d.stmt};`;
  if (node.type === "end")   return "return;";
  if (node.type === "merge") return "// merge;";
  if (node.type === "loop")  return `// loop ${d.label ?? "items"};`;
  if (node.type === "parameter") return "// parameter (reference only);";
  // Placeholder for blocks added on the canvas that have no MDL yet.
  const name = `$NewValue${++ctx.synth}`;
  return `DECLARE ${name} String = '${(d.label ?? "TODO").replace(/'/g, "''")}';`;
}

/** All node ids reachable from `from` (bounded). */
function reachable(from: string, ctx: Ctx): Set<string> {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length && seen.size < 500) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    (ctx.outs.get(id) ?? []).forEach((edge) => queue.push(edge.target));
  }
  return seen;
}

/** First node on the false path that the true path also reaches (the if-join). */
function findJoin(trueId: string | undefined, falseId: string | undefined, ctx: Ctx): string | undefined {
  if (!trueId || !falseId) return undefined;
  const trueSide = reachable(trueId, ctx);
  const queue = [falseId];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (trueSide.has(id)) return id;
    (ctx.outs.get(id) ?? []).forEach((edge) => queue.push(edge.target));
  }
  return undefined;
}

function walk(id: string | undefined, stopId: string | undefined, ctx: Ctx, indent: string) {
  while (id && id !== stopId) {
    if (ctx.visited.has(id)) return;
    ctx.visited.add(id);
    const node = ctx.byId.get(id);
    if (!node) return;

    if (node.type === "start") {
      id = ctx.outs.get(id)?.[0]?.target;
      continue;
    }

    if (node.type === "decision") {
      const branches = ctx.outs.get(id) ?? [];
      const truthy = branches.find((b) => (b.label ?? "").toLowerCase() === "true") ?? branches[0];
      const falsy = branches.find((b) => b !== truthy);
      const join = findJoin(truthy?.target, falsy?.target, ctx);
      annotations(node, ctx, indent);
      ctx.lines.push(`${indent}if ${data(node).stmt ?? data(node).label ?? "true"} then`);
      walk(truthy?.target, join, ctx, indent + "  ");
      if (falsy) {
        ctx.lines.push(`${indent}else`);
        walk(falsy.target, join, ctx, indent + "  ");
      }
      ctx.lines.push(`${indent}end if;`);
      id = join;
      continue;
    }

    annotations(node, ctx, indent);
    ctx.lines.push(`${indent}${statement(node, ctx)}`);
    if (node.type === "end") return;
    id = ctx.outs.get(id)?.[0]?.target;
  }
}

/** Microflow body MDL for the canvas graph (content between BEGIN and END). */
export function flowBodyMdl(nodes: Node[], edges: Edge[]): string {
  const ctx: Ctx = {
    byId: new Map(nodes.map((node) => [node.id, node])),
    outs: new Map(),
    lines: [],
    visited: new Set(),
    synth: 0,
  };
  edges.forEach((edge) => {
    const list = ctx.outs.get(edge.source) ?? [];
    list.push({ target: edge.target, label: typeof edge.label === "string" ? edge.label : undefined });
    ctx.outs.set(edge.source, list);
  });

  const start = nodes.find((node) => node.type === "start");
  walk(start?.id, undefined, ctx, "  ");

  // Blocks not connected to the main path yet still serialize, so nothing the
  // user added silently disappears from the draft.
  nodes.forEach((node) => {
    if (ctx.visited.has(node.id) || node.type === "start") return;
    annotations(node, ctx, "  ");
    ctx.lines.push(`  ${statement(node, ctx)}`);
    ctx.visited.add(node.id);
  });

  return ctx.lines.join("\n");
}
