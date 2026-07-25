import { useMemo, useState } from "react";

// Studio Pro-style toolbox, contextual to the selected editor:
// - page/snippet -> widget palette (layout, text, buttons, inputs, data, building blocks)
// - microflow/nanoflow -> activity palette
// - entity/domain model -> domain palette
// Styled after Studio Pro: search on top, collapsible groups, pictogram cards.

type Item = { icon: string; label: string; flowType?: string; flowKind?: string; flowStmt?: string };
type Group = { title: string; items: Item[] };

// Callable actions discovered from the project inventory (Java/JavaScript
// actions and micro/nanoflows). Installed marketplace modules — e.g. an OQL
// module exposing "Execute OQL", "OQL Variable" — surface here automatically.
export type FlowAction = {
  qn: string;
  label: string;
  module: string;
  kind: "javaaction" | "javascriptaction" | "microflow" | "nanoflow";
};

const ACTION_ICON: Record<FlowAction["kind"], string> = {
  javaaction: "☕", javascriptaction: "𝒋", microflow: "⚙", nanoflow: "⚡",
};

// Which callable kinds belong in each flow editor, Studio Pro-style.
const ACTIONS_FOR: Record<string, FlowAction["kind"][]> = {
  microflow: ["javaaction", "microflow"],
  nanoflow: ["javascriptaction", "nanoflow", "microflow"],
};

// MDL CALL statement for a callable action, so a dragged block serializes as a
// real "call" activity (not a placeholder). Params are left empty for the user.
const CALL_MDL: Record<FlowAction["kind"], (qn: string) => string> = {
  javaaction: (qn) => `CALL JAVA ACTION ${qn} ()`,
  javascriptaction: (qn) => `CALL JAVASCRIPT ACTION ${qn} ()`,
  microflow: (qn) => `CALL MICROFLOW ${qn} ()`,
  nanoflow: (qn) => `CALL NANOFLOW ${qn} ()`,
};

// Group inventory actions by module into collapsible toolbox groups.
function actionGroups(context: string | undefined, actions: FlowAction[]): Group[] {
  const kinds = ACTIONS_FOR[context ?? ""];
  if (!kinds) return [];
  const relevant = actions.filter((a) => kinds.includes(a.kind));
  const byModule = new Map<string, Item[]>();
  for (const a of relevant) {
    const items = byModule.get(a.module) ?? [];
    items.push({
      icon: ACTION_ICON[a.kind],
      label: a.label,
      flowType: "activity",
      flowKind: "action",
      flowStmt: CALL_MDL[a.kind](a.qn),
    });
    byModule.set(a.module, items);
  }
  return [...byModule.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mod, items]) => ({ title: mod, items: items.sort((x, y) => x.label.localeCompare(y.label)) }));
}

const act = (icon: string, label: string, kind = "action"): Item => ({ icon, label, flowType: "activity", flowKind: kind });

const FLOW_GROUPS: Group[] = [
  { title: "Object activities", items: [
    act("⬇", "Cast object", "assign"), act("✎", "Change object", "assign"),
    act("✔", "Commit object(s)"), act("＋", "Create object"),
    act("🗑", "Delete object(s)"), act("⤵", "Retrieve"), act("↺", "Rollback object"),
  ] },
  { title: "List activities", items: [
    act("Σ", "Aggregate list"), act("⇄", "Change list"),
    act("＋", "Create list"), act("≣", "List operation"),
  ] },
  { title: "Action call activities", items: [
    act("☕", "Java action call"), act("⚙", "Microflow call"),
  ] },
  { title: "Variable activities", items: [
    act("✎", "Change variable", "assign"), act("＋", "Create variable"),
  ] },
  { title: "Client activities", items: [
    act("▤", "Show page"), act("⚑", "Show message"), act("↧", "Download file"),
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

export default function Toolbox({ context, actions = [] }: { context?: string; actions?: FlowAction[] }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"widgets" | "blocks">("widgets");
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const isPage = !context || ["page", "snippet", "layout", "pagetemplate"].includes(context);
  const groups = useMemo(() => {
    // Standard activities, then a group per module of installed actions.
    const base = [...groupsFor(context, tab), ...actionGroups(context, actions)];
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base
      .map((g) => ({ ...g, items: g.items.filter((it) => it.label.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length);
  }, [context, tab, query, actions]);

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
                      const isFlow = context === "microflow" || context === "nanoflow";
                      if (isFlow && it.flowType) {
                        e.dataTransfer.setData(
                          "application/flow-node",
                          JSON.stringify({ type: it.flowType, kind: it.flowKind ?? "action", label: it.label, stmt: it.flowStmt }),
                        );
                      } else {
                        e.dataTransfer.setData("application/mrb-item", JSON.stringify(it));
                      }
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
