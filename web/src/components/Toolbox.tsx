// Static Studio Pro-style toolbox. In this read-only phase it is a visual
// reference of the activity palette; wiring it to drag-to-add is future work.

const GROUPS: { title: string; items: { icon: string; label: string }[] }[] = [
  {
    title: "Object activities",
    items: [
      { icon: "⬇", label: "Cast object" }, { icon: "✎", label: "Change object" },
      { icon: "✔", label: "Commit object(s)" }, { icon: "＋", label: "Create object" },
      { icon: "🗑", label: "Delete object(s)" }, { icon: "⤵", label: "Retrieve" },
      { icon: "↺", label: "Rollback object" },
    ],
  },
  {
    title: "List activities",
    items: [
      { icon: "Σ", label: "Aggregate list" }, { icon: "⇄", label: "Change list" },
      { icon: "＋", label: "Create list" }, { icon: "≣", label: "List operation" },
    ],
  },
  {
    title: "Action call activities",
    items: [
      { icon: "☕", label: "Java action call" }, { icon: "⚙", label: "Microflow call" },
    ],
  },
  {
    title: "Variable activities",
    items: [
      { icon: "✎", label: "Change variable" }, { icon: "＋", label: "Create variable" },
    ],
  },
  {
    title: "Client activities",
    items: [
      { icon: "▤", label: "Show page" }, { icon: "⚑", label: "Show message" },
    ],
  },
];

export default function Toolbox() {
  return (
    <div className="toolbox">
      <div className="toolbox-title">Toolbox</div>
      {GROUPS.map((g) => (
        <div className="tb-group" key={g.title}>
          <div className="tb-group-title">{g.title}</div>
          <div className="tb-items">
            {g.items.map((it) => (
              <div className="tb-item" key={it.label} title={it.label}>
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
