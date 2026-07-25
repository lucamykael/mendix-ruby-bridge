import { useState } from "react";

// Studio Pro-style "Add new element" dialog, opened by keyboard shortcuts or
// the ＋ New header button. Creates directly in the source .mpr via mxcli.

const KINDS = [
  { id: "page", label: "Page", icon: "▤" },
  { id: "microflow", label: "Microflow", icon: "⚙" },
  { id: "nanoflow", label: "Nanoflow", icon: "⚡" },
  { id: "entity", label: "Entity", icon: "▦" },
  { id: "enumeration", label: "Enumeration", icon: "≔" },
  { id: "module", label: "Module", icon: "▣" },
];

interface Props {
  initialKind?: string;
  modules: string[];
  onClose: () => void;
  onCreated: (qn: string) => void;
}

export default function NewElementModal({ initialKind, modules, onClose, onCreated }: Props) {
  const [kind, setKind] = useState(initialKind ?? "page");
  const [name, setName] = useState("");
  const [mod, setMod] = useState(modules[0] ?? "");
  const [folder, setFolder] = useState("");
  const [studioClosed, setStudioClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const isModule = kind === "module";
  const valid = /^[A-Za-z][A-Za-z0-9_]*$/.test(name) && (isModule || mod);

  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await fetch("/api/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind, name,
          module: isModule ? undefined : mod,
          folder: isModule || !folder.trim() ? undefined : folder.trim(),
          studio_closed: studioClosed,
        }),
      });
      const body = (await r.json()) as { ok?: boolean; qn?: string; message?: string; error?: string };
      if (r.ok && body.ok) {
        onCreated(body.qn ?? (isModule ? name : `${mod}.${name}`));
      } else {
        setError(body.message ?? body.error ?? `HTTP ${r.status}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Add new element</div>

        <div className="new-el-kinds">
          {KINDS.map((k) => (
            <button
              key={k.id}
              className={"new-el-kind" + (kind === k.id ? " on" : "")}
              onClick={() => setKind(k.id)}
            >
              <span>{k.icon}</span> {k.label}
            </button>
          ))}
        </div>

        {!isModule && (
          <label className="modal-field">
            <span>Module</span>
            <select value={mod} onChange={(e) => setMod(e.target.value)}>
              {modules.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        )}

        <label className="modal-field">
          <span>Name</span>
          <input
            value={name}
            autoFocus
            placeholder={isModule ? "MyModule" : "MyNewElement"}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && valid && studioClosed && !busy) void create(); }}
          />
        </label>

        {!isModule && (
          <label className="modal-field">
            <span>Folder (optional, e.g. Pages/Admin)</span>
            <input value={folder} placeholder="Created if it doesn't exist" onChange={(e) => setFolder(e.target.value)} />
          </label>
        )}

        <label className="git-hint" title="Creating writes to the .mpr, which Studio Pro locks while open">
          <input type="checkbox" checked={studioClosed} onChange={(e) => setStudioClosed(e.target.checked)} />
          Studio Pro is closed
        </label>

        {error && <div className="git-error">{error}</div>}

        <div className="modal-actions">
          <button className="editor-secondary" onClick={onClose}>Cancel</button>
          <button className="w-btn" disabled={!valid || !studioClosed || busy} onClick={() => void create()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
