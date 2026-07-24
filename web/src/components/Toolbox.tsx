// Studio Pro-style toolbox, contextual to the selected editor:
// - page/snippet -> widget palette (layout, text, buttons, inputs, data, building blocks)
// - microflow/nanoflow -> activity palette
// - entity/domain model -> domain palette
// In this read-only phase it is a visual palette; drag-to-add is future work.

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
  { title: "Layout", items: [
    { icon: "▭", label: "Container" }, { icon: "▦", label: "Layout grid" }, { icon: "▤", label: "Table" },
    { icon: "◫", label: "Group box" }, { icon: "❐", label: "Tab container" }, { icon: "⇳", label: "Scroll container" },
  ] },
  { title: "Text", items: [
    { icon: "T", label: "Text" }, { icon: "H", label: "Heading" }, { icon: "🖼", label: "Image" },
  ] },
  { title: "Buttons & links", items: [
    { icon: "⬛", label: "Button" }, { icon: "🔗", label: "Link button" }, { icon: "▶", label: "Action button" },
  ] },
  { title: "Input elements", items: [
    { icon: "▭", label: "Text box" }, { icon: "☐", label: "Check box" }, { icon: "▾", label: "Combo box" },
    { icon: "◉", label: "Radio buttons" }, { icon: "📅", label: "Date picker" }, { icon: "≡", label: "Drop-down" },
  ] },
  { title: "Data containers", items: [
    { icon: "▤", label: "Data view" }, { icon: "▦", label: "Data grid 2" }, { icon: "≣", label: "List view" },
    { icon: "🖼", label: "Gallery" }, { icon: "⊞", label: "Template grid" }, { icon: "⤵", label: "Reference selector" },
  ] },
  { title: "Building blocks", items: [
    { icon: "🧱", label: "Cards" }, { icon: "🧱", label: "Lists" }, { icon: "🧱", label: "Headers" },
  ] },
];

const DOMAIN_GROUPS: Group[] = [
  { title: "Domain model", items: [
    { icon: "🗄", label: "Entity" }, { icon: "🔗", label: "Association" }, { icon: "🔤", label: "Enumeration" },
  ] },
];

function groupsFor(context?: string): { title: string; groups: Group[] } {
  switch (context) {
    case "microflow":
    case "nanoflow":
      return { title: "Toolbox · Activities", groups: FLOW_GROUPS };
    case "entity":
    case "domainmodel":
      return { title: "Toolbox · Domain", groups: DOMAIN_GROUPS };
    case "page":
    case "snippet":
    case "layout":
    case "pagetemplate":
      return { title: "Toolbox · Widgets", groups: WIDGET_GROUPS };
    default:
      return { title: "Toolbox · Widgets", groups: WIDGET_GROUPS };
  }
}

export default function Toolbox({ context }: { context?: string }) {
  const { title, groups } = groupsFor(context);
  return (
    <div className="toolbox">
      <div className="toolbox-title">{title}</div>
      {groups.map((g) => (
        <div className="tb-group" key={g.title}>
          <div className="tb-group-title">{g.title}</div>
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
        </div>
      ))}
    </div>
  );
}
