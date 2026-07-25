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
