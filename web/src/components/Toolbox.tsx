import { useMemo, useState } from "react";

// Studio Pro-style toolbox, contextual to the selected editor:
// - page/snippet -> widget palette (layout, text, buttons, inputs, data, building blocks)
// - microflow/nanoflow -> activity palette
// - entity/domain model -> domain palette
// Styled after Studio Pro: search on top, collapsible groups, pictogram cards.

type Item = { icon: string; label: string };
type Group = { title: string; items: Item[] };

const FLOW_GROUPS: Group[] = [
  { title: "Object activities", items: [
    { icon: "⬇", label: "Cast object" }, { icon: "✎", label: "Change object" },
    { icon: "✔", label: "Commit object(s)" }, { icon: "＋", label: "Create object" },
    { icon: "🗑", label: "Delete object(s)" }, { icon: "⤵", label: "Retrieve" },
    { icon: "↺", label: "Rollback object" },
  ] },
  { title: "List activities", items: [
    { icon: "Σ", label: "Aggregate list" }, { icon: "⇄", label: "Change list" },
    { icon: "＋", label: "Create list" }, { icon: "≣", label: "List operation" },
  ] },
  { title: "Action call activities", items: [
    { icon: "☕", label: "Java action call" }, { icon: "⚙", label: "Microflow call" },
  ] },
  { title: "Variable activities", items: [
    { icon: "✎", label: "Change variable" }, { icon: "＋", label: "Create variable" },
  ] },
  { title: "Client activities", items: [
    { icon: "▤", label: "Show page" }, { icon: "⚑", label: "Show message" }, { icon: "↧", label: "Download file" },
  ] },
];

const WIDGET_GROUPS: Group[] = [
  { title: "Data containers", items: [
    { icon: "▤", label: "Data view" }, { icon: "▦", label: "Data grid 2" }, { icon: "≣", label: "List view" },
    { icon: "🖼", label: "Gallery" }, { icon: "⊞", label: "Template grid" }, { icon: "⤵", label: "Reference selector" },
  ] },
  { title: "Text", items: [
    { icon: "𝐀", label: "Text" }, { icon: "𝐇", label: "Heading" }, { icon: "🖼", label: "Image" },
  ] },
  { title: "Structure", items: [
    { icon: "▭", label: "Container" }, { icon: "▥", label: "Layout grid" }, { icon: "▦", label: "Table" },
    { icon: "◫", label: "Group box" }, { icon: "❐", label: "Tab container" }, { icon: "⇳", label: "Scroll container" },
  ] },
  { title: "Buttons & links", items: [
    { icon: "▣", label: "Button" }, { icon: "🔗", label: "Link button" }, { icon: "▶", label: "Action button" },
  ] },
  { title: "Input elements", items: [
    { icon: "▭", label: "Text box" }, { icon: "☑", label: "Check box" }, { icon: "▾", label: "Combo box" },
    { icon: "◉", label: "Radio buttons" }, { icon: "📅", label: "Date picker" }, { icon: "≡", label: "Drop-down" },
  ] },
];

const BLOCK_GROUPS: Group[] = [
  { title: "Building blocks", items: [
    { icon: "🧱", label: "Cards" }, { icon: "🧱", label: "Lists" }, { icon: "🧱", label: "Headers" },
  ] },
];

const DOMAIN_GROUPS: Group[] = [
  { title: "Domain model", items: [
    { icon: "🗄", label: "Entity" }, { icon: "🔗", label: "Association" }, { icon: "🔤", label: "Enumeration" },
  ] },
];

function groupsFor(context: string | undefined, tab: string): Group[] {
  switch (context) {
    case "microflow":
    case "nanoflow":
      return FLOW_GROUPS;
    case "entity":
    case "domainmodel":
      return DOMAIN_GROUPS;
    default:
      return tab === "blocks" ? BLOCK_GROUPS : WIDGET_GROUPS;
  }
}

export default function Toolbox({ context }: { context?: string }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"widgets" | "blocks">("widgets");
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const isPage = !context || ["page", "snippet", "layout", "pagetemplate"].includes(context);
  const groups = useMemo(() => {
    const base = groupsFor(context, tab);
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base
      .map((g) => ({ ...g, items: g.items.filter((it) => it.label.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length);
  }, [context, tab, query]);

  const toggle = (title: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  return (
    <div className="toolbox">
      <div className="toolbox-title">Toolbox</div>
      {isPage && (
        <div className="tb-tabs">
          <button className={tab === "widgets" ? "on" : ""} onClick={() => setTab("widgets")}>Widgets</button>
          <button className={tab === "blocks" ? "on" : ""} onClick={() => setTab("blocks")}>Building blocks</button>
        </div>
      )}
      <input
        className="tb-search"
        type="search"
        placeholder="Search…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {groups.map((g) => {
        const open = !closed.has(g.title);
        return (
          <div className="tb-group" key={g.title}>
            <button className="tb-group-title" onClick={() => toggle(g.title)}>
              <span className={"tb-chev" + (open ? " open" : "")}>▸</span>
              {g.title}
            </button>
            {open && (
              <div className="tb-items">
                {g.items.map((it) => (
                  <div
                    className="tb-item"
                    key={it.label}
                    title={`Drag onto the canvas to add ${it.label}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/mrb-item", JSON.stringify(it));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                  >
                    <span className="tb-icon">{it.icon}</span>
                    <span className="tb-label">{it.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {!groups.length && <p className="empty pad">No matches.</p>}
    </div>
  );
}
