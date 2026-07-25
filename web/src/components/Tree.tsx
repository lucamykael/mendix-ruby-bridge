import { useMemo, useState } from "react";
import type { TreeNode } from "../model/types";

// Compact Studio Pro-like glyphs, coloured per type via .t-<type> CSS classes.
const ICONS: Record<string, string> = {
  module: "▣", folder: "▸", page: "▤", entity: "▦", association: "⤝",
  microflow: "⚙", nanoflow: "⚡", enumeration: "≔", layout: "◫", snippet: "⌗",
  domainmodel: "◈", security: "🔒", projectsecurity: "🔒", userrole: "○", modulerole: "○",
  navigation: "◮", settings: "⚙", javascriptaction: "𝒋", javaaction: "𝒋",
  buildingblock: "▩", pagetemplate: "▤", imagecollection: "◲", constant: "π",
};
const icon = (t: string) => ICONS[t] ?? "·";

export interface Selection {
  qn: string;
  type: string;
  label: string;
}

interface Props {
  tree: TreeNode[];
  hasDetail: (qn: string) => boolean;
  selected?: string;
  onSelect: (sel: Selection) => void;
}

function matches(node: TreeNode, q: string, pagesOnly: boolean): boolean {
  const self =
    (!pagesOnly || node.type === "page") &&
    (!q || (node.label || node.qualifiedName || "").toLowerCase().includes(q));
  return self || (node.children ?? []).some((c) => matches(c, q, pagesOnly));
}

function TreeItem({ node, ...p }: Props & { node: TreeNode; q: string; pagesOnly: boolean }) {
  const kids = node.children ?? [];
  const [open, setOpen] = useState(node.type !== "module" && node.type !== "folder");
  const forceOpen = (p.q || p.pagesOnly) && kids.length > 0;
  const detail = node.qualifiedName ? p.hasDetail(node.qualifiedName) : false;
  const isSel = node.qualifiedName && node.qualifiedName === p.selected;

  if ((p.q || p.pagesOnly) && !matches(node, p.q, p.pagesOnly)) return null;

  return (
    <li>
      <div
        className={"node" + (isSel ? " selected" : "")}
        onClick={() => {
          if (detail) p.onSelect({ qn: node.qualifiedName!, type: node.type, label: node.label });
          else if (kids.length) setOpen((o) => !o);
        }}
      >
        <span className="twist" onClick={(e) => { e.stopPropagation(); if (kids.length) setOpen((o) => !o); }}>
          {kids.length ? (open || forceOpen ? "▾" : "▸") : ""}
        </span>
        <span className={`t-ico t-${node.type}`}>{icon(node.type)}</span>
        <span className="label">{node.label || node.qualifiedName}</span>
        {kids.length > 0 && <span className="count">{kids.length}</span>}
      </div>
      {kids.length > 0 && (open || forceOpen) && (
        <ul>
          {kids.map((c, i) => (
            <TreeItem key={c.qualifiedName ?? c.label + i} {...p} node={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Tree(p: Props) {
  const [q, setQ] = useState("");
  const [pagesOnly, setPagesOnly] = useState(false);
  const ql = q.trim().toLowerCase();
  const roots = useMemo(() => p.tree, [p.tree]);

  return (
    <div className="tree-wrap">
      <div className="tree-title">App Explorer</div>
      <div className="tree-controls">
        <input type="search" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label>
          <input type="checkbox" checked={pagesOnly} onChange={(e) => setPagesOnly(e.target.checked)} /> Pages
        </label>
      </div>
      <ul className="tree">
        {roots.map((n, i) => (
          <TreeItem key={n.qualifiedName ?? n.label + i} {...p} node={n} q={ql} pagesOnly={pagesOnly} />
        ))}
      </ul>
    </div>
  );
}
