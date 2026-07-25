// Serialize an editable widget tree back into page-content MDL (the body inside
// the page's `{ ... }`). Inverse of widgetTree in page.ts; the backend wraps this
// in CREATE OR MODIFY PAGE and validates it with `mxcli check`.

import type { EditableNode } from "./pageTree";

function line(node: EditableNode, indent: string, nextName: () => number): string {
  // MDL requires a name identifier before the props parenthesis; synthesize one
  // for parsed widgets that came in unnamed.
  const name = node.name ?? (node.props.trim() ? `${node.type}${nextName()}` : undefined);
  const head = [node.type, name].filter(Boolean).join(" ");
  const props = node.props.trim() ? ` (${node.props.trim()})` : "";

  if (node.children !== undefined) {
    const inner = node.children.map((child) => line(child, indent + "  ", nextName)).join("\n");
    const body = inner ? `\n${inner}\n${indent}` : "";
    return `${indent}${head}${props} {${body}}`;
  }
  return `${indent}${head}${props}`;
}

/** MDL for the page body (root children), without the CREATE OR MODIFY PAGE wrapper. */
export function toPageMdl(root: EditableNode): string {
  let n = 900; // high start to avoid clashing with existing widget names
  const nextName = () => ++n;
  return (root.children ?? []).map((child) => line(child, "", nextName)).join("\n");
}

/**
 * Build a minimal `ALTER PAGE` from the diff between the originally-loaded tree
 * and the edited tree — so only changed widgets are touched and everything else
 * on the page is preserved exactly (unlike CREATE OR MODIFY, which rebuilds the
 * whole page). Returns null when the diff can't be expressed as ALTER operations
 * (reorders, re-parenting, or missing widget names), so the caller falls back to
 * a full regenerate.
 *
 * Operations used:
 *   - REPLACE widget WITH { … }   — a widget whose own props changed
 *   - DROP WIDGET name            — a removed widget
 *   - INSERT AFTER/BEFORE anchor  — an added widget, anchored to a named sibling
 */
export function toAlterMdl(original: EditableNode, edited: EditableNode, qn: string): string | null {
  const ops: string[] = [];
  let nameCounter = 900;
  const nextName = () => ++nameCounter;
  const serialize = (node: EditableNode) => line(node, "    ", nextName).trimStart();

  let bailed = false;
  const bail = () => { bailed = true; };

  const diff = (o: EditableNode, e: EditableNode) => {
    if (bailed) return;

    // A change to this node's own props → replace the whole subtree.
    if ((o.props ?? "") !== (e.props ?? "")) {
      if (!e.name) return bail();
      ops.push(`  REPLACE ${e.name} WITH {\n    ${serialize(e)}\n  };`);
      return; // descendants are covered by the replacement
    }

    const oKids = o.children ?? [];
    const eKids = e.children ?? [];
    if (oKids.length === 0 && eKids.length === 0) return;

    const oById = new Map(oKids.map((c) => [c.id, c]));
    const eById = new Map(eKids.map((c) => [c.id, c]));

    // Reorder of surviving children isn't expressible as ALTER → bail.
    const commonInO = oKids.filter((c) => eById.has(c.id)).map((c) => c.id);
    const commonInE = eKids.filter((c) => oById.has(c.id)).map((c) => c.id);
    if (commonInO.join() !== commonInE.join()) return bail();

    // Removed children → DROP (their subtree goes with them).
    for (const c of oKids) {
      if (eById.has(c.id)) continue;
      if (!c.name) return bail();
      ops.push(`  DROP WIDGET ${c.name};`);
    }

    // Added children → INSERT relative to a surviving named sibling.
    eKids.forEach((c, i) => {
      if (bailed || oById.has(c.id)) return;
      const prev = [...eKids.slice(0, i)].reverse().find((s) => oById.has(s.id) && s.name);
      const next = eKids.slice(i + 1).find((s) => oById.has(s.id) && s.name);
      if (prev) ops.push(`  INSERT AFTER ${prev.name} {\n    ${serialize(c)}\n  };`);
      else if (next) ops.push(`  INSERT BEFORE ${next.name} {\n    ${serialize(c)}\n  };`);
      else bail(); // nothing to anchor to (e.g. empty container) → regenerate
    });

    // Recurse into surviving children.
    for (const c of eKids) {
      const oc = oById.get(c.id);
      if (oc) diff(oc, c);
    }
  };

  diff(original, edited);
  if (bailed || ops.length === 0) return null;
  return `ALTER PAGE ${qn} {\n${ops.join("\n")}\n};\n`;
}
