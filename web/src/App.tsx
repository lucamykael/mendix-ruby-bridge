import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Tree, { type Selection } from "./components/Tree";
import Canvas from "./components/Canvas";
import Detail from "./components/Detail";
import GitPanel from "./components/GitPanel";
import ERDiagram from "./components/ERDiagram";
import RightPanel from "./components/RightPanel";
import type { EditableNode } from "./components/PageBuilder";
import AppTerminal, { type TerminalMode } from "./components/AppTerminal";
import LoginModal from "./components/LoginModal";
import SettingsModal from "./components/SettingsModal";
import NewElementModal from "./components/NewElementModal";
import StudioDocumentDialog from "./components/StudioDocumentDialog";
import QueryPanel from "./components/QueryPanel";
import type { FlowAction } from "./components/Toolbox";
import { loadHealth, loadInventory } from "./model/data";
import { git, type GitStatus } from "./model/api";
import { collectAssocs } from "./model/er";
import type { BackendHealth, Inventory, TreeNode } from "./model/types";
import "./themes.css";
import "./App.css";

type View = "explorer" | "git" | "er";
type BottomTab = "details" | "changes" | "errors" | "console" | "oql" | "find" | "variables" | "debugger" | "breakpoints";

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

interface Violation {
  ruleId?: string; severity?: string; message?: string;
  module?: string; document?: string; documentType?: string; qn?: string; suggestion?: string;
}

function ErrorsPane({ onOpen }: { onOpen?: (qn: string) => void }) {
  const [violations, setViolations] = useState<Violation[]>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const r = await fetch("/api/errors");
      const body = (await r.json()) as { ok?: boolean; violations?: Violation[]; message?: string; error?: string };
      if (r.ok && body.ok) setViolations(body.violations ?? []);
      else setError(body.message ?? body.error ?? `HTTP ${r.status}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void run(); }, [run]);

  return (
    <div className="detail-drawer console-pane errors-pane">
      <div className="errors-head">
        <span>Project consistency check <span className="muted">(mxcli lint)</span></span>
        <button className="editor-secondary" onClick={() => void run()} disabled={loading}>
          {loading ? "Checking…" : "↻ Re-check"}
        </button>
      </div>
      {error && <p className="pb-err">{error}</p>}
      {violations && violations.length === 0 && !error && (
        <p className="pb-ok">No consistency issues found. ✓</p>
      )}
      {violations && violations.length > 0 && (
        <div className="errors-list">
          {violations.map((v, i) => (
            <div
              key={i}
              className={`error-row sev-${v.severity ?? "warning"}` + (v.qn ? " clickable" : "")}
              onClick={() => v.qn && onOpen?.(v.qn)}
              title={v.qn ? `Open ${v.qn}` : undefined}
            >
              <span className={`error-sev sev-${v.severity ?? "warning"}`}>{v.severity ?? "warning"}</span>
              <span className="error-rule">{v.ruleId}</span>
              <span className="error-msg">
                {v.message}
                {v.qn && <span className="error-qn"> · {v.qn}</span>}
                {v.suggestion && <span className="error-fix"> — {v.suggestion}</span>}
              </span>
            </div>
          ))}
        </div>
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
const LIGHT_SUFFIX = "-light";
function isDark(theme: string) { return !theme.endsWith(LIGHT_SUFFIX); }
function toggleThemeMode(theme: string) {
  return isDark(theme) ? theme + LIGHT_SUFFIX : theme.replace(LIGHT_SUFFIX, "");
}

const MARKETPLACE_MODULES = new Set([
  "Administration",
  "Atlas_Core",
  "Atlas_Web_Content",
  "DataWidgets",
  "FeedbackModule",
  "NanoflowCommons",
  "WebActions",
]);

function appName(sourceProject?: string): string {
  const file = sourceProject?.split(/[\\/]/).pop() ?? "App";
  return file.replace(/\.mpr$/i, "") || "App";
}

function buildAppExplorer(tree: TreeNode[], sourceProject?: string): TreeNode[] {
  const appDocuments = tree.filter((node) => node.type !== "module").map((node) =>
    node.type === "projectsecurity" ? { ...node, label: "Security" } : node);
  if (!appDocuments.some((node) => node.type === "styling"))
    appDocuments.push({ label: "Styling", type: "styling", qualifiedName: "Styling" });
  const appOrder: Record<string, number> = {
    settings: 0, projectsecurity: 1, navigation: 2, styling: 3, systemoverview: 4,
  };
  appDocuments.sort((left, right) =>
    (appOrder[left.type] ?? 99) - (appOrder[right.type] ?? 99));
  const modules = tree.filter((node) => node.type === "module").map((module) => {
    const children = (module.children ?? []).map((child) =>
      child.type === "security" && !child.qualifiedName
        ? { ...child, qualifiedName: `${module.label}.Security` }
        : child,
    );
    if (!children.some((child) => child.type === "modulesettings"))
      children.unshift({ label: "Settings", type: "modulesettings", qualifiedName: `${module.label}.Settings` });
    return { ...module, children };
  });
  const system = modules.filter((node) => node.label === "System");
  const marketplace = modules.filter((node) => MARKETPLACE_MODULES.has(node.label));
  const authored = modules.filter(
    (node) => node.label !== "System" && !MARKETPLACE_MODULES.has(node.label),
  );

  return [
    {
      label: `App '${appName(sourceProject)}'`,
      type: "app",
      qualifiedName: "App",
      children: [
        ...appDocuments,
        ...(marketplace.length
          ? [{
              label: "Marketplace modules",
              type: "marketplacemodules",
              qualifiedName: "MarketplaceModules",
              children: marketplace,
            }]
          : []),
      ],
    },
    ...authored,
    ...system,
  ];
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
  const [footerGitStatus, setFooterGitStatus] = useState<GitStatus>();
  const [sel, setSel] = useState<Selection>();
  // Studio Pro-style document tabs: every opened element stays in a tab
  // until it's explicitly closed; selecting activates or appends its tab.
  const [openTabs, setOpenTabs] = useState<Selection[]>([]);
  const openDoc = useCallback((s: Selection) => {
    setSel(s);
    setOpenTabs((tabs) =>
      tabs.some((t) => t.qn === s.qn)
        ? tabs.map((t) => (t.qn === s.qn ? s : t))
        : [...tabs, s],
    );
  }, []);
  const closeDoc = (qn: string) => {
    const idx = openTabs.findIndex((t) => t.qn === qn);
    const next = openTabs.filter((t) => t.qn !== qn);
    setOpenTabs(next);
    if (sel?.qn === qn) setSel(next[Math.min(Math.max(idx, 0), next.length - 1)]);
  };
  const [view, setView] = useState<View>("explorer");
  const [bottomTab, setBottomTab] = useState<BottomTab>();
  const [theme, setTheme] = useState(() => localStorage.getItem("mrb-theme") ?? DEFAULT_THEME);
  const [erModule, setErModule] = useState<string>();
  const [draftQns, setDraftQns] = useState<DraftStatus>(new Map());
  const [terminalMode, setTerminalMode] = useState<TerminalMode>("hidden");
  const [appRunning, setAppRunning] = useState(false);
  const [appBusy, setAppBusy] = useState(false);
  const [pageWidget, setPageWidget] = useState<EditableNode | undefined>();
  const pageWidgetChangeFn = useRef<((p: string) => void) | undefined>(undefined);
  const handleWidgetSelect = useCallback(
    (node: EditableNode | undefined, changeFn: ((p: string) => void) | undefined) => {
      setPageWidget(node);
      pageWidgetChangeFn.current = changeFn;
    },
    [],
  );
  const handleWidgetChange = useCallback((props: string) => pageWidgetChangeFn.current?.(props), []);
  const [showLogin, setShowLogin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [studioDialog, setStudioDialog] = useState<Selection>();
  const [newElementKind, setNewElementKind] = useState<string>();
  const [loggedIn, setLoggedIn] = useState(false);
  const [authUser, setAuthUser] = useState<string | null>(null);
  const [appPort, setAppPort] = useState(8080);

  useEffect(() => {
    loadInventory().then(setInv).catch((e) => setError(String(e)));
    loadHealth().then((h) => {
      setHealth(h);
      if (h.app?.running) { setAppRunning(true); setTerminalMode("docked"); }
      if (h.auth?.logged_in) { setLoggedIn(true); setAuthUser(h.auth.username ?? null); }
    }).catch(() => setHealth(undefined));
    loadDraftStatus().then(setDraftQns).catch(() => null);
    fetch("/api/settings")
      .then((r) => r.json() as Promise<{ settings?: { APP_PORT?: string } }>)
      .then((d) => { const p = parseInt(d.settings?.APP_PORT ?? ""); if (p > 0) setAppPort(p); })
      .catch(() => null);
  }, []);

  useEffect(() => {
    if (!health?.capabilities?.git) return;
    const update = () => git.status().then(setFooterGitStatus).catch(() => null);
    const onStatus = (event: Event) =>
      setFooterGitStatus((event as CustomEvent<GitStatus>).detail);
    update();
    const timer = window.setInterval(update, 3000);
    window.addEventListener("mrb:git-status", onStatus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("mrb:git-status", onStatus);
    };
  }, [health?.capabilities?.git]);

  // Keep appRunning truthful even when the console isn't visible (the
  // terminal's log poller is the primary source, but it only runs while
  // docked/floating). Poll the status endpoint while we believe the app is up.
  useEffect(() => {
    if (!appRunning) return;
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/app/status");
        const s = (await r.json()) as { running?: boolean };
        if (!s.running) setAppRunning(false);
      } catch { /* backend unreachable — keep current state */ }
    }, 3000);
    return () => clearInterval(id);
  }, [appRunning]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mrb-theme", theme);
  }, [theme]);

  const assocs = useMemo(() => (inv ? collectAssocs(inv.details) : []), [inv]);
  const tree = useMemo(
    () => (inv ? buildAppExplorer(inv.tree, inv.meta.source_project) : []),
    [inv],
  );
  const moduleNames = useMemo(
    () => (inv?.tree ?? []).filter((n) => n.type === "module").map((n) => n.label),
    [inv],
  );

  // Callable actions (Java/JS actions + micro/nanoflows) from the inventory,
  // surfaced as draggable flow blocks. Installed modules (e.g. OQL) appear here.
  const flowActions = useMemo<FlowAction[]>(() => {
    if (!inv) return [];
    const acts: FlowAction[] = [];
    const kinds = new Set(["javaaction", "javascriptaction", "microflow", "nanoflow"]);
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (kinds.has(n.type) && n.qualifiedName) {
          acts.push({
            qn: n.qualifiedName,
            label: n.label || n.qualifiedName.split(".").pop() || n.qualifiedName,
            module: n.qualifiedName.split(".")[0],
            kind: n.type as FlowAction["kind"],
          });
        }
        if (n.children) walk(n.children);
      }
    };
    walk(inv.tree);
    return acts;
  }, [inv]);

  // Persistable entity qualified names — used by the OQL↔SQL converter to map
  // Module.Entity references to/from their database table names.
  const entityQns = useMemo<string[]>(() => {
    if (!inv) return [];
    const qns: string[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === "entity" && n.qualifiedName) qns.push(n.qualifiedName);
        if (n.children) walk(n.children);
      }
    };
    walk(inv.tree);
    return qns;
  }, [inv]);

  // Compact project summary handed to the AI chat so it can reason about (and
  // modify) the actual project — modules, entities, pages, microflows.
  const aiContext = useMemo<string>(() => {
    if (!inv) return "";
    const by: Record<string, string[]> = {};
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.qualifiedName && ["entity", "page", "microflow", "nanoflow", "enumeration"].includes(n.type)) {
          (by[n.type] ??= []).push(n.qualifiedName);
        }
        if (n.children) walk(n.children);
      }
    };
    walk(inv.tree);
    const line = (label: string, key: string) =>
      by[key]?.length ? `${label} (${by[key].length}): ${by[key].slice(0, 40).join(", ")}${by[key].length > 40 ? ", …" : ""}` : "";
    return [
      `Modules: ${moduleNames.join(", ")}`,
      line("Entities", "entity"),
      line("Pages", "page"),
      line("Microflows", "microflow"),
      line("Nanoflows", "nanoflow"),
      line("Enumerations", "enumeration"),
    ].filter(Boolean).join("\n");
  }, [inv, moduleNames]);

  // Studio Pro-style creation shortcuts (Alt-based — browsers reserve
  // Ctrl+N/T/W and pages cannot intercept them). Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      const kinds: Record<string, string> = {
        n: "page", p: "page", m: "module", l: "microflow", e: "entity",
      };
      const kind = kinds[e.key.toLowerCase()];
      if (!kind) return;
      e.preventDefault();
      setNewElementKind(kind);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    openDoc(found ?? { qn, type: inv.details[qn]?.kind ?? "element", label: qn.split(".").pop() ?? qn });
  };

  const openDomainModel = (moduleName: string) => {
    setErModule(moduleName);
    setView("er");
  };


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
    { id: "oql", label: "OQL / SQL" },
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
          {health?.capabilities?.git && (
            <button className={view === "git" ? "on" : ""} onClick={() => setView("git")}>Git</button>
          )}
        </nav>

        <span className="header-project">{projectName}</span>

        <span className="spacer" />

        <div className="header-actions">
          <button
            className="hdr-btn"
            title="Add new element — Alt+N page · Alt+M module · Alt+L microflow · Alt+E entity"
            onClick={() => setNewElementKind("page")}
          >
            ＋ New
          </button>
          <button
            className="hdr-btn hdr-run"
            title={health?.capabilities?.app_run ? (appRunning ? "Restart application" : "Run application") : "Configure MRB_RUN_CMD to enable"}
            disabled={!health?.capabilities?.app_run || appBusy}
            onClick={async () => {
              setAppBusy(true);
              try {
                if (appRunning) {
                  await fetch("/api/app/stop", { method: "POST" });
                  setTerminalMode("docked");
                  // Docker teardown is async on the backend — wait until the
                  // status endpoint reports the app actually stopped.
                  for (let i = 0; i < 60; i++) {
                    await new Promise((r) => setTimeout(r, 2000));
                    try {
                      const s = await fetch("/api/app/status");
                      const st = (await s.json()) as { running?: boolean };
                      if (!st.running) break;
                    } catch { break; }
                  }
                }
                const r = await fetch("/api/app/run", { method: "POST" });
                setTerminalMode("docked");
                setAppRunning(r.ok || r.status === 409);
              } finally {
                setAppBusy(false);
              }
            }}
          >
            {appBusy ? "⟳ …" : appRunning ? "↺ Re-Run" : "▶ Run"}
          </button>
          <button
            className="hdr-btn hdr-stop"
            title="Stop application"
            disabled={!appRunning || appBusy}
            onClick={async () => {
              await fetch("/api/app/stop", { method: "POST" });
              // Show the teardown in the console; the pollers flip the
              // buttons back once the backend reports the app stopped.
              setTerminalMode("docked");
            }}
          >
            ■ Stop
          </button>
          <button
            className="hdr-btn hdr-view"
            title={appRunning ? "View running application" : "Application is not running"}
            disabled={!appRunning}
            onClick={() => window.open(`http://localhost:${appPort}`, "_blank")}
          >
            ⊞ View
          </button>
          {terminalMode === "minimized" && (
            <button
              className="hdr-btn hdr-term"
              title="Show application console"
              onClick={() => setTerminalMode("docked")}
            >
              {appRunning ? "▶" : "■"} Console
            </button>
          )}
          <button
            className={`hdr-btn hdr-login ${loggedIn ? "hdr-login-on" : ""}`}
            title={loggedIn ? `Logged in as ${authUser ?? ""}` : "Login to Mendix"}
            onClick={() => setShowLogin(true)}
          >
            👤{loggedIn && <span className="hdr-login-user">{authUser?.split("@")[0]}</span>}
          </button>
          <button
            className="hdr-btn hdr-settings"
            title="Project settings"
            onClick={() => setShowSettings(true)}
          >
            ⚙
          </button>
        </div>

        <label className="theme-pick">
          Theme
          <select
            value={isDark(theme) ? theme : theme.replace(LIGHT_SUFFIX, "")}
            onChange={(e) => setTheme(isDark(theme) ? e.target.value : e.target.value + LIGHT_SUFFIX)}
          >
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <button
            className="theme-mode-btn"
            title={isDark(theme) ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setTheme(toggleThemeMode(theme))}
          >
            {isDark(theme) ? "☀" : "☾"}
          </button>
        </label>
      </header>

      {view === "git" ? (
        <GitPanel />
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
              onSelect={(selection) => {
                if (["settings", "projectsecurity", "navigation", "styling", "modulesettings", "security"].includes(selection.type))
                  setStudioDialog(selection);
                else openDoc(selection);
              }}
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
                  {openTabs.map((t) => (
                    <div
                      key={t.qn}
                      className={"doc-tab" + (t.qn === sel.qn ? " on" : "")}
                      onClick={() => setSel(t)}
                    >
                      <span className="doc-tab-label">
                        {t.label} <span className="doc-tab-module">[{t.qn.split(".")[0]}]</span>
                      </span>
                      <button
                        className="doc-tab-close"
                        title="Close"
                        onClick={(e) => { e.stopPropagation(); closeDoc(t.qn); }}
                      >×</button>
                    </div>
                  ))}
                </div>
                <div className="editor-bar">
                  <span className="editor-kind">{sel.type}</span>
                  <span className="editor-qn">{sel.qn}</span>
                </div>
                <div className="editor-body">
                  <Canvas selection={sel} details={inv.details} assocs={assocs} layouts={inv.layouts} onSelect={selectByQn} onWidgetSelect={handleWidgetSelect} />
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
                {bottomTab === "oql" && <QueryPanel entities={entityQns} />}
                {bottomTab === "errors" && <ErrorsPane onOpen={selectByQn} />}
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
            widgetNode={pageWidget}
            onWidgetChange={handleWidgetChange}
            flowActions={flowActions}
            onLogin={() => setShowLogin(true)}
            loggedIn={loggedIn}
            aiContext={aiContext}
          />
        </div>
      )}

      <AppTerminal
        mode={terminalMode}
        onModeChange={setTerminalMode}
        running={appRunning}
        onRunningChange={setAppRunning}
      />

      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onAuthChange={(s) => { setLoggedIn(s.logged_in); setAuthUser(s.username); }}
        />
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {studioDialog && inv && (
        <StudioDocumentDialog
          selection={studioDialog}
          details={inv.details}
          tree={inv.tree}
          onClose={() => setStudioDialog(undefined)}
        />
      )}
      {newElementKind && (
        <NewElementModal
          initialKind={newElementKind}
          modules={moduleNames}
          onClose={() => setNewElementKind(undefined)}
          onCreated={() => {
            setNewElementKind(undefined);
            // The backend refreshes the inventory in the background —
            // re-fetch after it has had time to describe the new element.
            setTimeout(() => { loadInventory().then(setInv).catch(() => null); }, 6000);
          }}
        />
      )}

      <footer className="statusbar">
        <img className="status-logo" src="/favicon.png" alt="" />
        <span>{health ? `Backend v${health.version}` : "Backend unavailable"}</span>
        {footerGitStatus && (
          <button className="status-branch" title="Open Git Repository"
            onClick={() => setView("git")}>⎇ {footerGitStatus.branch || "detached HEAD"}
            {!footerGitStatus.clean && <span>●</span>}</button>
        )}
        <span className="spacer" />
        {sel && <span>{sel.type} · {sel.qn}</span>}
        <span className="sb-meta">{meta.element_count ? `${meta.element_count} elements` : ""}</span>
        <span className="sb-meta">{`${inv.dependencies.edges.length} dependencies`}</span>
      </footer>
    </div>
  );
}
