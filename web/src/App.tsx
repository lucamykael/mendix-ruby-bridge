import { useEffect, useMemo, useState } from "react";
import Tree, { type Selection } from "./components/Tree";
import Canvas from "./components/Canvas";
import Detail from "./components/Detail";
import GitPanel from "./components/GitPanel";
import ERDiagram from "./components/ERDiagram";
import Drafts from "./components/Drafts";
import RightPanel from "./components/RightPanel";
import { loadHealth, loadInventory } from "./model/data";
import { git, type GitStatus } from "./model/api";
import { collectAssocs } from "./model/er";
import type { BackendHealth, Inventory, TreeNode } from "./model/types";
import "./themes.css";
import "./App.css";

type View = "explorer" | "git" | "er" | "drafts";
type BottomTab = "details" | "changes" | "errors" | "console" | "find" | "variables" | "debugger" | "breakpoints";

function ChangesPane() {
  const [status, setStatus] = useState<GitStatus>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    git.status().then(setStatus).catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, []);
  return (
    <div className="detail-drawer console-pane">
      {error && <p className="muted">Changes unavailable: {error}</p>}
      {status && (
        <>
          <p>
            Branch <code>{status.branch}</code> ·{" "}
            {status.clean ? "no uncommitted changes" : "uncommitted changes in the working tree"}
            {status.operation_in_progress ? ` · ${status.operation_in_progress} in progress` : ""}
          </p>
          <p className="muted">Commit, stash, and switch from the Git tab.</p>
        </>
      )}
    </div>
  );
}

const DEFAULT_THEME = "ruby";
const THEMES = [
  { id: "ruby", label: "Ruby" },
  { id: "studio-pro", label: "Studio Pro" },
  { id: "tokyo-night", label: "Tokyo Night" },
  { id: "dracula", label: "Dracula" },
  { id: "gruvbox", label: "Gruvbox" },
  { id: "catppuccin", label: "Catppuccin" },
];

function orderModules(tree: TreeNode[]): TreeNode[] {
  const rest = tree.filter((n) => !(n.type === "module" && n.label === "System"));
  const system = tree.filter((n) => n.type === "module" && n.label === "System");
  return [...rest, ...system];
}

type DraftStatus = Map<string, "valid" | "blocked">;

async function loadDraftStatus(): Promise<DraftStatus> {
  try {
    const r = await fetch("/api/drafts");
    if (!r.ok) return new Map();
    const data = (await r.json()) as {
      pages: Record<string, { valid?: boolean }>;
      flows?: Record<string, { valid?: boolean }>;
    };
    const m: DraftStatus = new Map();
    for (const [qn, d] of Object.entries(data.pages ?? {}))
      m.set(qn, d.valid !== false ? "valid" : "blocked");
    for (const [qn, d] of Object.entries(data.flows ?? {}))
      m.set(qn, d.valid !== false ? "valid" : "blocked");
    return m;
  } catch {
    return new Map();
  }
}

export default function App() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [error, setError] = useState<string>();
  const [health, setHealth] = useState<BackendHealth>();
  const [sel, setSel] = useState<Selection>();
  const [view, setView] = useState<View>("explorer");
  const [bottomTab, setBottomTab] = useState<BottomTab>();
  const [theme, setTheme] = useState(() => localStorage.getItem("mrb-theme") ?? DEFAULT_THEME);
  const [erModule, setErModule] = useState<string>();
  const [draftQns, setDraftQns] = useState<DraftStatus>(new Map());

  useEffect(() => {
    loadInventory().then(setInv).catch((e) => setError(String(e)));
    loadHealth().then(setHealth).catch(() => setHealth(undefined));
    loadDraftStatus().then(setDraftQns).catch(() => null);
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

  const openDomainModel = (moduleName: string) => {
    setErModule(moduleName);
    setView("er");
  };

  const refreshDrafts = () => loadDraftStatus().then(setDraftQns).catch(() => null);

  if (error) return (
    <div className="startup-state">
      <img src="/brand/mendix-ruby-bridge.png" alt="" />
      <div className="fatal">Failed to load inventory: {error}</div>
    </div>
  );
  if (!inv) return (
    <div className="startup-state">
      <img src="/brand/mendix-ruby-bridge.png" alt="" />
      <div className="loading">Loading inventory…</div>
    </div>
  );

  const meta = inv.meta;
  const detail = sel ? inv.details[sel.qn] : undefined;
  const incoming = sel ? inv.dependencies.edges.filter((edge) => edge.to === sel.qn) : [];
  const outgoing = sel ? inv.dependencies.edges.filter((edge) => edge.from === sel.qn) : [];

  const projectName = meta.source_project?.split("/").pop()?.replace(/\.mpr$/, "") ?? "Mendix Bridge";

  const BOTTOM_TABS: Array<{ id: BottomTab; label: string; stub?: boolean }> = [
    { id: "details", label: "Details" },
    { id: "changes", label: "Changes" },
    { id: "errors", label: "Errors" },
    { id: "console", label: "Console" },
    { id: "find", label: "Find Results" },
    { id: "variables", label: "Variables", stub: true },
    { id: "debugger", label: "Debugger", stub: true },
    { id: "breakpoints", label: "Breakpoints", stub: true },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">
          <img src="/brand/mendix-ruby-bridge.png" alt="Mendix Ruby Bridge" />
        </span>

        <nav className="tabs">
          <button className={view === "explorer" ? "on" : ""} onClick={() => setView("explorer")}>App Explorer</button>
          <button className={view === "er" ? "on" : ""} onClick={() => setView("er")}>ER Diagram</button>
          <button className={view === "drafts" ? "on" : ""} onClick={() => { setView("drafts"); refreshDrafts(); }}>Drafts</button>
          {health?.capabilities?.git && (
            <button className={view === "git" ? "on" : ""} onClick={() => setView("git")}>Git</button>
          )}
        </nav>

        <span className="header-project">{projectName}</span>

        <div className="header-actions">
          <button className="hdr-btn hdr-run" title="Run application" disabled>▶ Run</button>
          <button className="hdr-btn hdr-stop" title="Stop application" disabled>■ Stop</button>
          <button
            className="hdr-btn hdr-view"
            title="View running application"
            onClick={() => window.open("http://localhost:8080", "_blank")}
          >
            ⊞ View
          </button>
          <button className="hdr-btn hdr-login" title="Login to Mendix" disabled>
            <span>👤</span>
          </button>
        </div>

        <label className="theme-pick">
          Theme
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
      </header>

      {view === "git" ? (
        <GitPanel />
      ) : view === "drafts" ? (
        <Drafts
          health={health}
          onOpen={(qn) => {
            selectByQn(qn);
            setView("explorer");
          }}
        />
      ) : view === "er" ? (
        <ERDiagram
          tree={tree}
          details={inv.details}
          assocs={assocs}
          initialModule={erModule}
          onOpenEntity={(qn) => {
            selectByQn(qn);
            setView("explorer");
          }}
        />
      ) : (
        <div className="layout">
          <aside>
            <Tree
              tree={tree}
              hasDetail={(qn) => !!inv.details[qn]}
              selected={sel?.qn}
              onSelect={setSel}
              details={inv.details}
              draftQns={draftQns}
              onOpenDomainModel={openDomainModel}
            />
          </aside>

          <main>
            {!sel && <p className="empty pad">Select an element to explore it.</p>}
            {sel && detail && (
              <>
                <div className="doc-tabs">
                  <div className="doc-tab on">
                    <span className="doc-tab-label">
                      {sel.label} <span className="doc-tab-module">[{sel.qn.split(".")[0]}]</span>
                    </span>
                    <button className="doc-tab-close" title="Close" onClick={() => setSel(undefined)}>×</button>
                  </div>
                </div>
                <div className="editor-bar">
                  <span className="editor-kind">{sel.type}</span>
                  <span className="editor-qn">{sel.qn}</span>
                </div>
                <div className="editor-body">
                  <Canvas selection={sel} details={inv.details} assocs={assocs} layouts={inv.layouts} onSelect={selectByQn} />
                </div>
                {bottomTab === "details" && (
                  <div className="detail-drawer">
                    <Detail selection={sel} detail={detail} incoming={incoming} outgoing={outgoing} onSelect={selectByQn} />
                  </div>
                )}
                {bottomTab === "console" && (
                  <div className="detail-drawer console-pane">
                    <p>Backend v{health?.version ?? "?"} · {meta.element_count ?? "?"} elements · {inv.dependencies.edges.length} dependencies</p>
                    <p className="muted">Guarded writes (git, migrations, marketplace install) run through mxcli with Studio Pro closed.</p>
                  </div>
                )}
                {bottomTab === "changes" && <ChangesPane />}
                {bottomTab === "errors" && (
                  <div className="detail-drawer console-pane">
                    <p className="muted">No consistency errors reported. Run `mx check` via the guarded workflow for a full report.</p>
                  </div>
                )}
                {bottomTab === "find" && (
                  <div className="detail-drawer console-pane">
                    <p className="muted">No active search. Use filter in App Explorer to find elements.</p>
                  </div>
                )}
                {bottomTab === "variables" && (
                  <div className="detail-drawer console-pane">
                    <p className="muted">Variables inspector — available during debug session.</p>
                  </div>
                )}
                {bottomTab === "debugger" && (
                  <div className="detail-drawer console-pane">
                    <p className="muted">Debugger — connect a running Mendix app to inspect execution.</p>
                  </div>
                )}
                {bottomTab === "breakpoints" && (
                  <div className="detail-drawer console-pane">
                    <p className="muted">No breakpoints set.</p>
                  </div>
                )}
                <div className="console-bar">
                  {BOTTOM_TABS.map(({ id, label, stub }) => (
                    <button
                      key={id}
                      className={(bottomTab === id ? "on" : "") + (stub ? " stub" : "")}
                      onClick={() => setBottomTab((cur) => (cur === id ? undefined : id))}
                      title={stub ? `${label} — coming soon` : label}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="spacer" />
                  <span className="console-hint">{sel.type} · {sel.qn}</span>
                </div>
              </>
            )}
          </main>

          <RightPanel
            context={sel?.type}
            selection={sel}
            detail={detail}
          />
        </div>
      )}

      <footer className="statusbar">
        <img className="status-logo" src="/favicon.png" alt="" />
        <span>{health ? `Backend v${health.version}` : "Backend unavailable"}</span>
        <span className="spacer" />
        {sel && <span>{sel.type} · {sel.qn}</span>}
        <span className="sb-meta">{meta.element_count ? `${meta.element_count} elements` : ""}</span>
        <span className="sb-meta">{`${inv.dependencies.edges.length} dependencies`}</span>
      </footer>
    </div>
  );
}
