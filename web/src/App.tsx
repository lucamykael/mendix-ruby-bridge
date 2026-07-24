import { useEffect, useMemo, useState } from "react";
import Tree, { type Selection } from "./components/Tree";
import Canvas from "./components/Canvas";
import Detail from "./components/Detail";
import Marketplace from "./components/Marketplace";
import Toolbox from "./components/Toolbox";
import { loadInventory } from "./model/data";
import { collectAssocs } from "./model/er";
import type { Inventory, TreeNode } from "./model/types";
import "./themes.css";
import "./App.css";

type View = "explorer" | "marketplace";

const THEMES = [
  { id: "studio-pro", label: "Studio Pro" },
  { id: "tokyo-night", label: "Tokyo Night" },
  { id: "dracula", label: "Dracula" },
  { id: "gruvbox", label: "Gruvbox" },
  { id: "catppuccin", label: "Catppuccin" },
];

// Studio Pro shows the System module last; real creation order is not in the
// inventory, so we approximate by pinning System to the bottom (stable otherwise).
function orderModules(tree: TreeNode[]): TreeNode[] {
  const rest = tree.filter((n) => !(n.type === "module" && n.label === "System"));
  const system = tree.filter((n) => n.type === "module" && n.label === "System");
  return [...rest, ...system];
}

export default function App() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [error, setError] = useState<string>();
  const [sel, setSel] = useState<Selection>();
  const [view, setView] = useState<View>("explorer");
  const [theme, setTheme] = useState(() => localStorage.getItem("mrb-theme") ?? "studio-pro");

  useEffect(() => {
    loadInventory().then(setInv).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mrb-theme", theme);
  }, [theme]);

  const assocs = useMemo(() => (inv ? collectAssocs(inv.details) : []), [inv]);
  const tree = useMemo(() => (inv ? orderModules(inv.tree) : []), [inv]);

  const selectByQn = (qn: string) => {
    if (!inv) return;
    let found: Selection | undefined;
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.qualifiedName === qn) found = { qn, type: n.type, label: n.label };
        if (n.children) walk(n.children);
      }
    };
    walk(inv.tree);
    setSel(found ?? { qn, type: inv.details[qn]?.kind ?? "element", label: qn.split(".").pop() ?? qn });
  };

  if (error) return <div className="fatal">Failed to load inventory: {error}</div>;
  if (!inv) return <div className="loading">Loading inventory…</div>;

  const meta = inv.meta;
  const detail = sel ? inv.details[sel.qn] : undefined;
  const showToolbox = view === "explorer";

  return (
    <div className="app">
      <header>
        <span className="app-name">◆ {meta.source_project?.split("/").pop()?.replace(/\.mpr$/, "") ?? "Mendix Bridge"}</span>
        <nav className="tabs">
          <button className={view === "explorer" ? "on" : ""} onClick={() => setView("explorer")}>App Explorer</button>
          <button className={view === "marketplace" ? "on" : ""} onClick={() => setView("marketplace")}>Marketplace</button>
        </nav>
        <span className="spacer" />
        <label className="theme-pick">
          Theme
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
      </header>

      {view === "marketplace" ? (
        <Marketplace />
      ) : (
        <div className="layout">
          <aside>
            <Tree tree={tree} hasDetail={(qn) => !!inv.details[qn]} selected={sel?.qn} onSelect={setSel} />
          </aside>
          <main>
            {!sel && <p className="empty pad">Select an element to explore it.</p>}
            {sel && detail && (
              <>
                <Canvas selection={sel} details={inv.details} assocs={assocs} onSelect={selectByQn} />
                <Detail selection={sel} detail={detail} onSelect={selectByQn} />
              </>
            )}
          </main>
          {showToolbox && <Toolbox />}
        </div>
      )}

      <footer className="statusbar">
        <span>Ready</span>
        <span className="spacer" />
        {sel && <span>{sel.type} · {sel.qn}</span>}
        <span className="sb-meta">{meta.element_count ? `${meta.element_count} elements` : ""}</span>
      </footer>
    </div>
  );
}
