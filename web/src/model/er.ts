// Build a domain ER neighbourhood (a centre entity + directly associated
// entities) as React Flow nodes/edges.

import type { Edge, Node } from "@xyflow/react";
import type { ElementDetail } from "./types";

export interface Assoc {
  qn: string;
  from: string;
  to: string;
  type?: string;
  owner?: string;
}

export function collectAssocs(details: Record<string, ElementDetail>): Assoc[] {
  return Object.entries(details)
    .filter(([, v]) => v && v.from && v.to)
    .map(([qn, v]) => ({ qn, from: v.from as string, to: v.to as string, type: v.association_type, owner: v.owner }));
}

function entityLabel(qn: string, d: ElementDetail | undefined): string {
  const name = qn.split(".").pop() ?? qn;
  const attrs = Array.isArray(d?.attributes) ? d!.attributes! : [];
  const shown = attrs.slice(0, 8);
  const lines = shown.map((a) => `${a.name}${a.type ? " : " + a.type : ""}`);
  if (attrs.length > shown.length) lines.push(`+${attrs.length - shown.length} more`);
  return `${name}\n${lines.join("\n")}`;
}

/** ER neighbourhood for a centre entity. */
export function erGraph(
  centerQn: string,
  details: Record<string, ElementDetail>,
  assocs: Assoc[],
): { nodes: Node[]; edges: Edge[] } {
  const related = assocs.filter((a) => a.from === centerQn || a.to === centerQn);
  const neighbours: string[] = [];
  related.forEach((a) => {
    const other = a.from === centerQn ? a.to : a.from;
    if (other !== centerQn && !neighbours.includes(other)) neighbours.push(other);
  });

  const colX = [40, 380, 720];
  const layout: Record<string, { col: number; i: number }> = { [centerQn]: { col: 1, i: 0 } };
  let li = 0;
  let ri = 0;
  neighbours.forEach((qn, idx) => {
    layout[qn] = idx % 2 === 0 ? { col: 0, i: li++ } : { col: 2, i: ri++ };
  });

  const place = (qn: string): Node => {
    const lo = layout[qn];
    return {
      id: qn,
      position: { x: colX[lo.col], y: 30 + lo.i * 170 },
      data: { label: entityLabel(qn, details[qn]) },
      style: {
        background: "#1d2636",
        color: "#d7e0ee",
        border: qn === centerQn ? "2px solid #6ea8fe" : "1px solid #3a5ea8",
        borderRadius: 8,
        fontSize: 11,
        textAlign: "left" as const,
        whiteSpace: "pre" as const,
        width: 210,
        padding: 8,
      },
    };
  };

  const nodes: Node[] = [place(centerQn), ...neighbours.map(place)];
  const edges: Edge[] = related.map((a, i) => ({
    id: `a${i}`,
    source: a.from,
    target: a.to,
    label: `${a.type === "ReferenceSet" ? "*" : "1"} ${a.qn.split(".").pop()}`,
    style: { stroke: "#6a7a94" },
    labelStyle: { fill: "#8595ac", fontSize: 10 },
  }));
  return { nodes, edges };
}
