import { useEffect, useMemo, useState } from "react";
import Tree, { type Selection } from "./components/Tree";
import Canvas from "./components/Canvas";
import Detail from "./components/Detail";
import Marketplace from "./components/Marketplace";
import { loadInventory } from "./model/data";
import { collectAssocs } from "./model/er";
import type { Inventory } from "./model/types";
import "./App.css";

type View = "explorer" | "marketplace";

export default function App() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [error, setError] = useState<string>();
  const [sel, setSel] = useState<Selection>();
  const [view, setView] = useState<View>("explorer");

  useEffect(() => {
    loadInventory().then(setInv).catch((e) => setError(String(e)));
  }, []);

  const assocs = useMemo(() => (inv ? collectAssocs(inv.details) : []), [inv]);

  const selectByQn = (qn: string) => {
    if (!inv) return;
    let found: Selection | undefined;
    const walk = (nodes: Inventory["tree"]) => {
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

  return (
    <div className="app">
      <header>
        <h1>Mendix Bridge</h1>
        <nav className="tabs">
          <button className={view === "explorer" ? "on" : ""} onClick={() => setView("explorer")}>
            Explorer
          </button>
          <button className={view === "marketplace" ? "on" : ""} onClick={() => setView("marketplace")}>
            Marketplace
          </button>
        </nav>
        <span className="meta">
          {meta.source_project?.split("/").pop()} {meta.element_count ? `· ${meta.element_count} elements` : ""}
        </span>
      </header>
      {view === "marketplace" ? (
        <Marketplace />
      ) : (
        <div className="layout">
          <aside>
            <Tree tree={inv.tree} hasDetail={(qn) => !!inv.details[qn]} selected={sel?.qn} onSelect={setSel} />
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
        </div>
      )}
    </div>
  );
}
