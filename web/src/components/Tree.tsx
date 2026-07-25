import { useEffect, useMemo, useState } from "react";
import type { ElementDetail, TreeNode } from "../model/types";

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
  details?: Record<string, ElementDetail>;
  draftQns?: Map<string, "valid" | "blocked">;
  onOpenDomainModel?: (moduleName: string) => void;
}

interface Sweep {
  mode: "expand" | "collapse";
  tick: number;
}

function matches(node: TreeNode, q: string, pagesOnly: boolean): boolean {
  const self =
    (!pagesOnly || node.type === "page") &&
    (!q || (node.label || node.qualifiedName || "").toLowerCase().includes(q));
  return self || (node.children ?? []).some((c) => matches(c, q, pagesOnly));
}

function DraftDot({ status }: { status: "valid" | "blocked" }) {
  return (
    <span
      className={`draft-dot draft-dot-${status}`}
      title={status === "valid" ? "Valid draft pending apply" : "Blocked draft"}
    />
  );
}

function EntityBadge({ persistable }: { persistable?: boolean }) {
  if (persistable === undefined) return null;
  return (
    <span
      className={`entity-badge ${persistable ? "entity-persistent" : "entity-transient"}`}
      title={persistable ? "Persistent entity" : "Non-persistent entity"}
    >
      {persistable ? "P" : "NP"}
    </span>
  );
}

function TreeItem({
  node, sweep, details, draftQns, onOpenDomainModel, ...p
}: Props & {
  node: TreeNode;
  q: string;
  pagesOnly: boolean;
  sweep?: Sweep;
  details?: Record<string, ElementDetail>;
  draftQns?: Map<string, "valid" | "blocked">;
  onOpenDomainModel?: (moduleName: string) => void;
}) {
  const kids = node.children ?? [];
  const [open, setOpen] = useState(node.type !== "module" && node.type !== "folder");
  const forceOpen = (p.q || p.pagesOnly) && kids.length > 0;
  const detail = node.qualifiedName ? p.hasDetail(node.qualifiedName) : false;
  const isSel = node.qualifiedName && node.qualifiedName === p.selected;
  const draftStatus = node.qualifiedName ? draftQns?.get(node.qualifiedName) : undefined;
  const entityDetail = node.type === "entity" && node.qualifiedName ? details?.[node.qualifiedName] : undefined;
  const isDomainModel = node.type === "domainmodel";

  useEffect(() => {
    if (sweep) setOpen(sweep.mode === "expand");
  }, [sweep]);

  if ((p.q || p.pagesOnly) && !matches(node, p.q, p.pagesOnly)) return null;

  const handleClick = () => {
    if (isDomainModel && onOpenDomainModel) {
      const moduleName = node.qualifiedName?.split(".")[0] ?? node.label;
      onOpenDomainModel(moduleName);
      return;
    }
    if (detail) p.onSelect({ qn: node.qualifiedName!, type: node.type, label: node.label });
    else if (kids.length) setOpen((o) => !o);
  };

  const handleDoubleClick = () => {
    if (isDomainModel && onOpenDomainModel) {
      const moduleName = node.qualifiedName?.split(".")[0] ?? node.label;
      onOpenDomainModel(moduleName);
    }
  };

  return (
    <li>
      <div
        className={"node" + (isSel ? " selected" : "")}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {kids.length ? (
          <span
            className="twist box"
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          >
            {open || forceOpen ? "−" : "+"}
          </span>
        ) : (
          <span className="twist dot">○</span>
        )}
        <span className={`t-ico t-${node.type}`}>{icon(node.type)}</span>
        <span className="label">{node.label || node.qualifiedName}</span>
        {entityDetail && <EntityBadge persistable={entityDetail.persistable} />}
        {kids.length > 0 && <span className="count">{kids.length}</span>}
        {draftStatus && <DraftDot status={draftStatus} />}
      </div>
      {kids.length > 0 && (open || forceOpen) && (
        <ul>
          {kids.map((c, i) => (
            <TreeItem
              key={c.qualifiedName ?? c.label + i}
              {...p}
              node={c}
              sweep={sweep}
              details={details}
              draftQns={draftQns}
              onOpenDomainModel={onOpenDomainModel}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Tree(p: Props) {
  const [q, setQ] = useState("");
  const pagesOnly = false;
  const [sweep, setSweep] = useState<Sweep>();
  const ql = q.trim().toLowerCase();
  const roots = useMemo(() => p.tree, [p.tree]);

  return (
    <div className="tree-wrap">
      <div className="tree-title">App Explorer</div>
      <div className="tree-controls">
        <span className="tree-find">🔍</span>
        <input type="search" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
        <button
          className="tree-sweep" title="Expand all"
          onClick={() => setSweep((s) => ({ mode: "expand", tick: (s?.tick ?? 0) + 1 }))}
        >⊞</button>
        <button
          className="tree-sweep" title="Collapse all"
          onClick={() => setSweep((s) => ({ mode: "collapse", tick: (s?.tick ?? 0) + 1 }))}
        >⊟</button>
      </div>
      <ul className="tree">
        {roots.map((n, i) => (
          <TreeItem
            key={n.qualifiedName ?? n.label + i}
            {...p}
            node={n}
            q={ql}
            pagesOnly={pagesOnly}
            sweep={sweep}
            details={p.details}
            draftQns={p.draftQns}
            onOpenDomainModel={p.onOpenDomainModel}
          />
        ))}
      </ul>
    </div>
  );
}
