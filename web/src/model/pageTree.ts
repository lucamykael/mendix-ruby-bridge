// Editable widget-tree helpers for the visual page builder. Extends the parsed
// WidgetNode with a stable id (assigned on load) so selection survives reorders,
// and provides immutable insert/move/remove/update by id. The widget factory maps
// Toolbox labels to Mendix widget types + sensible default props.

import type { WidgetNode } from "./page";

export interface EditableNode extends WidgetNode {
  id: string;
  children?: EditableNode[];
}

// Containers accept children; structural ones render without chrome. Mirrors the
// sets used by the preview so nesting behaves the same.
export const CONTAINERS = new Set([
  "layoutgrid", "row", "column", "container", "scrollcontainer", "table",
  "dataview", "groupbox", "tabcontainer", "tabpage", "footer", "header",
  "snippetcall", "listview", "templategrid", "sidebartoggle",
]);
export const STRUCTURAL = new Set(["layoutgrid", "row", "column", "container", "scrollcontainer", "table"]);

export const isContainer = (type: string) => CONTAINERS.has(type.toLowerCase());

let counter = 0;
const newId = () => `w${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Assign stable ids to a freshly parsed tree. */
export function withIds(node: WidgetNode): EditableNode {
  return {
    ...node,
    id: newId(),
    children: node.children?.map(withIds),
  };
}

export function emptyPage(): EditableNode {
  return { id: newId(), type: "page", props: "", children: [] };
}

// ---- widget factory --------------------------------------------------------

interface WidgetDef {
  type: string;
  props?: string;
}

const FACTORY: Record<string, WidgetDef> = {
  // Layout
  "Container": { type: "container" },
  "Layout grid": { type: "layoutgrid" },
  "Table": { type: "table" },
  "Group box": { type: "groupbox", props: "Caption: 'Group box'" },
  "Tab container": { type: "tabcontainer" },
  "Scroll container": { type: "scrollcontainer" },
  // Text
  "Text": { type: "dynamictext", props: "Content: 'New text'" },
  "Heading": { type: "dynamictext", props: "Content: 'Heading'" },
  "Image": { type: "image" },
  // Buttons & links
  "Button": { type: "button", props: "Caption: 'Button'" },
  "Link button": { type: "linkbutton", props: "Caption: 'Link'" },
  "Action button": { type: "actionbutton", props: "Caption: 'Action'" },
  // Input elements
  "Text box": { type: "textbox", props: "Label: 'Text box', Attribute: Attribute" },
  "Check box": { type: "checkbox", props: "Label: 'Check box', Attribute: Attribute" },
  "Combo box": { type: "combobox", props: "Label: 'Combo box', Attribute: Attribute" },
  "Radio buttons": { type: "radiobuttons", props: "Label: 'Radio buttons', Attribute: Attribute" },
  "Date picker": { type: "datepicker", props: "Label: 'Date', Attribute: Attribute" },
  "Drop-down": { type: "dropdown", props: "Label: 'Drop-down', Attribute: Attribute" },
  // Data containers
  "Data view": { type: "dataview", props: "DataSource: $object" },
  "Data grid 2": { type: "datagrid2", props: "DataSource: $objects" },
  "List view": { type: "listview", props: "DataSource: $objects" },
  "Gallery": { type: "gallery", props: "DataSource: $objects" },
  "Template grid": { type: "templategrid", props: "DataSource: $objects" },
  "Reference selector": { type: "referenceselector", props: "Label: 'Reference', Attribute: Attribute" },
  // Building blocks -> generic containers
  "Cards": { type: "container" },
  "Lists": { type: "container" },
  "Headers": { type: "header" },
};

/** Build a new node for a Toolbox label. */
export function widgetFromLabel(label: string): EditableNode {
  const def = FACTORY[label] ?? { type: label.toLowerCase().replace(/[^a-z0-9]+/g, ""), props: `Caption: '${label}'` };
  const node: EditableNode = { id: newId(), type: def.type, props: def.props ?? "" };
  if (isContainer(def.type)) node.children = [];
  return node;
}

// ---- immutable tree operations --------------------------------------------

export function findNode(root: EditableNode, id: string): EditableNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return undefined;
}

function isAncestor(root: EditableNode, ancestorId: string, maybeDescendantId: string): boolean {
  const ancestor = findNode(root, ancestorId);
  return !!ancestor && !!findNode(ancestor, maybeDescendantId) && ancestorId !== maybeDescendantId;
}

/** Remove a node by id, returning the new tree and the removed node. */
function removeNode(root: EditableNode, id: string): { tree: EditableNode; removed?: EditableNode } {
  let removed: EditableNode | undefined;
  const walk = (node: EditableNode): EditableNode => {
    if (!node.children) return node;
    const kept: EditableNode[] = [];
    for (const child of node.children) {
      if (child.id === id) removed = child;
      else kept.push(walk(child));
    }
    return { ...node, children: kept };
  };
  return { tree: walk(root), removed };
}

/** Insert `node` as a child of `parentId` at `index` (clamped). */
function insertNode(root: EditableNode, parentId: string, index: number, node: EditableNode): EditableNode {
  const walk = (current: EditableNode): EditableNode => {
    if (current.id === parentId) {
      const children = [...(current.children ?? [])];
      const at = Math.max(0, Math.min(index, children.length));
      children.splice(at, 0, node);
      return { ...current, children };
    }
    if (!current.children) return current;
    return { ...current, children: current.children.map(walk) };
  };
  return walk(root);
}

export function insert(root: EditableNode, parentId: string, index: number, node: EditableNode): EditableNode {
  return insertNode(root, parentId, index, node);
}

export function remove(root: EditableNode, id: string): EditableNode {
  return removeNode(root, id).tree;
}

/** Move an existing node under a new parent/index. No-op if it would nest into itself. */
export function move(root: EditableNode, id: string, parentId: string, index: number): EditableNode {
  if (id === parentId || isAncestor(root, id, parentId)) return root;
  const { tree, removed } = removeNode(root, id);
  if (!removed) return root;
  return insertNode(tree, parentId, index, removed);
}

/** Patch a node's props string by id. */
export function update(root: EditableNode, id: string, props: string): EditableNode {
  const walk = (node: EditableNode): EditableNode => {
    if (node.id === id) return { ...node, props };
    if (!node.children) return node;
    return { ...node, children: node.children.map(walk) };
  };
  return walk(root);
}
