// Parse a microflow/nanoflow MDL body into a graph of blocks, then map it to
// React Flow nodes/edges. Best-effort structured parse of `@position`/`@caption`
// plus the `if / else / end if` control structure. Ported from the verified
// vanilla implementation in the Ruby-side HTML viewer.

import type { Edge, Node } from "@xyflow/react";

export type FlowKind = "terminal" | "decision" | "validation" | "action" | "assign";

interface RawNode {
  id: number;
  kind: FlowKind;
  label: string;
  stmt: string | null; // original MDL statement (or decision expression), for round-trip
  x: number | null;
  y: number | null;
}
interface RawEdge {
  from: number;
  to: number;
  label: string | null;
}

const clip = (s: string, n: number) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

function parseFlow(mdl: string): { nodes: RawNode[]; edges: RawEdge[] } | null {
  const begin = mdl.indexOf("\nbegin");
  if (begin === -1) return null;
  let body = mdl.slice(begin + 6).replace(/\nend;\s*$/, "\n");

  const nodes: RawNode[] = [];
  const edges: RawEdge[] = [];
  let counter = 0;
  const add = (kind: FlowKind, label: string, pos: { x: number; y: number } | null, stmt: string | null = null) => {
    const id = counter++;
    nodes.push({ id, kind, label: clip(label, 46), stmt, x: pos ? pos.x : null, y: pos ? pos.y : null });
    return id;
  };
  const startId = add("terminal", "Start", null);
  let prevs: Array<{ id: number; label: string | null }> = [{ id: startId, label: null }];
  const stack: Array<{ id: number; inElse: boolean; trueTails: typeof prevs }> = [];
  let pos: { x: number; y: number } | null = null;
  let caption: string | null = null;
  const connect = (to: number) => prevs.forEach((p) => edges.push({ from: p.id, to, label: p.label }));
  const kindOf = (t: string): FlowKind => {
    if (/^return\b/.test(t)) return "terminal";
    if (/^validation\b/.test(t)) return "validation";
    if (/\bcall\b/.test(t)) return "action";
    if (/^(declare|set)\b/.test(t)) return "assign";
    return "action";
  };

  let buf = "";
  const flush = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (/^if\b/.test(t)) {
      const expr = t.replace(/^if\s+/, "").replace(/\s+then$/, "");
      const id = add("decision", caption || expr, pos, expr);
      connect(id);
      pos = null;
      caption = null;
      stack.push({ id, inElse: false, trueTails: [] });
      prevs = [{ id, label: "true" }];
    } else if (/^else$/.test(t)) {
      const ctx = stack[stack.length - 1];
      ctx.trueTails = prevs;
      ctx.inElse = true;
      prevs = [{ id: ctx.id, label: "false" }];
    } else if (/^end if;?$/.test(t)) {
      const ctx = stack.pop()!;
      const falseTails = ctx.inElse ? prevs : [{ id: ctx.id, label: "false" }];
      const trueTails = ctx.inElse ? ctx.trueTails : prevs;
      prevs = trueTails.concat(falseTails);
    } else if (/^(begin|end)\b/.test(t) || t.startsWith("@")) {
      // annotations handled elsewhere
    } else {
      const id = add(kindOf(t), caption || t, pos, t);
      connect(id);
      pos = null;
      caption = null;
      prevs = [{ id, label: null }];
    }
  };

  body.split("\n").forEach((line) => {
    const l = line.trim();
    const mp = l.match(/@position\((-?\d+),\s*(-?\d+)\)/);
    if (mp) {
      pos = { x: +mp[1], y: +mp[2] };
      return;
    }
    const mc = l.match(/@caption\s+'([^']*)'/);
    if (mc) {
      caption = mc[1];
      return;
    }
    if (l.startsWith("@")) return;
    // Skip comment lines — they must not become flow blocks.
    if (l.startsWith("//") || l.startsWith("/*") || l.startsWith("*") || l === "/" || l.endsWith("*/")) return;
    buf += (buf ? " " : "") + l;
    if (/;$/.test(l) || /\bthen$/.test(l) || /^else$/.test(l) || /^end if;?$/.test(l) || /^if\b.*\bthen$/.test(buf)) {
      flush(buf);
      buf = "";
    }
  });
  if (buf.trim()) flush(buf);
  return { nodes, edges };
}

const nodeType = (n: RawNode): string => {
  if (n.kind === "decision") return "decision";
  if (n.kind === "terminal") return n.label === "Start" ? "start" : "end";
  return "activity";
};

/** Build React Flow nodes/edges for a microflow/nanoflow MDL. */
export function flowGraph(mdl: string): { nodes: Node[]; edges: Edge[] } | null {
  const g = parseFlow(mdl);
  if (!g || !g.nodes.length) return null;

  // Place nodes lacking @position by walking the graph left-to-right, like
  // Studio Pro lays microflows out: successors go right, extra branches from a
  // decision fan out vertically. Real @position coordinates are kept as-is.
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  const posNodes = g.nodes.filter((n) => n.x != null);
  const baseY = posNodes.length ? Math.round(posNodes.reduce((s, n) => s + (n.y as number), 0) / posNodes.length) : 0;
  const leftX = posNodes.length ? Math.min(...posNodes.map((n) => n.x as number)) : 0;
  if (byId[0] && byId[0].x == null) {
    byId[0].x = leftX - 230;
    byId[0].y = baseY;
  }
  const branchCount: Record<number, number> = {};
  for (let pass = 0; pass < 6; pass++) {
    g.edges.forEach((e) => {
      const to = byId[e.to];
      const from = byId[e.from];
      if (to && to.x == null && from && from.x != null) {
        const branch = branchCount[e.from] ?? 0;
        branchCount[e.from] = branch + 1;
        to.x = (from.x as number) + 230;
        to.y = (from.y as number) + (branch === 0 ? 0 : (branch % 2 ? -1 : 1) * Math.ceil(branch / 2) * 130);
      }
    });
  }
  let autoX = leftX;
  g.nodes.forEach((n) => {
    if (n.x == null) {
      n.x = autoX;
      n.y = baseY + 200;
      autoX += 230;
    }
  });

  const sx = 0.55;
  const sy = 0.75;
  const minX = Math.min(...g.nodes.map((n) => n.x as number));
  const minY = Math.min(...g.nodes.map((n) => n.y as number));

  const nodes: Node[] = g.nodes.map((n) => ({
    id: String(n.id),
    type: nodeType(n),
    position: { x: ((n.x as number) - minX) * sx, y: ((n.y as number) - minY) * sy },
    data: { label: n.label, kind: n.kind, stmt: n.stmt },
  }));
  const edges: Edge[] = g.edges.map((e, i) => ({
    id: `e${i}`,
    source: String(e.from),
    target: String(e.to),
    label: e.label ?? undefined,
    animated: false,
    style: { stroke: "var(--edge)" },
    labelStyle: { fill: "var(--fg)", fontSize: 10 },
    labelBgStyle: { fill: "var(--panel)", stroke: "var(--line)" },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 2,
  }));
  return { nodes, edges };
}
