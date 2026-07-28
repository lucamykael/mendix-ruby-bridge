import { useCallback, useEffect, useRef, useState } from "react";
import {
  git,
  type GitCommit,
  type GitFileStatus,
  type GitRef,
  type GitStatus,
  type GitWorktree,
} from "../model/api";

// ── Lane graph constants ─────────────────────────────────────────────────────
const LANE_W = 14;
const ROW_H  = 28;
const LANE_COLORS = ["#4ec9b0","#569cd6","#ce9178","#b5cea8","#dcdcaa","#c586c0","#f48771","#9cdcfe"];

// ── Types ─────────────────────────────────────────────────────────────────────
interface CommitWithLane extends GitCommit {
  lane: number;
  lanesTop: (string | null)[];
  lanesAfter: (string | null)[];
}

interface CtxMenu {
  x: number;
  y: number;
  items: Array<{ label: string; action: () => void; danger?: boolean } | "sep">;
}

interface TerminalEntry {
  command: string;
  output: string;
  failed?: boolean;
}

// ── Lane algorithm ────────────────────────────────────────────────────────────
function computeLanes(commits: GitCommit[]): CommitWithLane[] {
  const lanes: (string | null)[] = [];
  return commits.map((commit) => {
    const lanesTop = [...lanes];
    let myLane = lanes.indexOf(commit.sha);
    if (myLane === -1) {
      const free = lanes.indexOf(null);
      myLane = free === -1 ? lanes.length : free;
    }
    while (lanes.length <= myLane) lanes.push(null);
    const firstParent = commit.parents[0] ?? null;
    if (firstParent) {
      const fp = lanes.indexOf(firstParent);
      lanes[myLane] = fp === -1 || fp === myLane ? firstParent : null;
      if (fp !== -1 && fp !== myLane) {
        // first parent already tracked in fp; free myLane
        lanes[myLane] = null;
      }
    } else {
      lanes[myLane] = null;
    }
    for (let p = 1; p < commit.parents.length; p++) {
      const par = commit.parents[p];
      if (lanes.indexOf(par) === -1) {
        const free = lanes.indexOf(null);
        const slot = free === -1 ? lanes.length : free;
        while (lanes.length <= slot) lanes.push(null);
        lanes[slot] = par;
      }
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    return { ...commit, lane: myLane, lanesTop, lanesAfter: [...lanes] };
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function lc(i: number) { return LANE_COLORS[i % LANE_COLORS.length]; }

function statusStyle(char: string): { letter: string; color: string } {
  switch (char) {
    case "M": return { letter: "M", color: "#e5c07b" };
    case "A": return { letter: "A", color: "#98c379" };
    case "D": return { letter: "D", color: "#e06c75" };
    case "R": return { letter: "R", color: "#61afef" };
    case "C": return { letter: "C", color: "#61afef" };
    case "U": return { letter: "!", color: "#e06c75" };
    case "?": return { letter: "?", color: "#7a8294" };
    default:  return { letter: char, color: "#7a8294" };
  }
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso.slice(0, 10); }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ContextMenu({ ctx, onClose }: { ctx: CtxMenu; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="gv-ctx"
      style={{ left: ctx.x, top: ctx.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {ctx.items.map((item, i) =>
        item === "sep" ? (
          <div key={i} className="gv-ctx-sep" />
        ) : (
          <button
            key={i}
            className={"gv-ctx-item" + (item.danger ? " danger" : "")}
            onClick={() => { item.action(); onClose(); }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

function RefBadge({ ref: r }: { ref: GitRef }) {
  const cls =
    r.type === "head" ? "gb-head" :
    r.type === "tag"  ? "gb-tag"  :
    r.type === "remote" ? "gb-remote" : "gb-local";
  return <span className={`gb ${cls}`}>{r.name}</span>;
}

function GraphRow({
  commit, maxLanes, selected, onSelect, onCtx,
}: {
  commit: CommitWithLane;
  maxLanes: number;
  selected: boolean;
  onSelect: () => void;
  onCtx: (e: React.MouseEvent) => void;
}) {
  const numLanes = Math.max(maxLanes, commit.lane + 1);
  const W = numLanes * LANE_W + LANE_W;
  const lines: React.ReactNode[] = [];
  const cx = commit.lane * LANE_W + 7;

  for (let i = 0; i < numLanes; i++) {
    const hasTop    = commit.lanesTop[i] != null;
    const hasBottom = commit.lanesAfter[i] != null;
    const x = i * LANE_W + 7;
    const col = lc(i);
    const isMine = i === commit.lane;

    if (isMine) {
      if (hasTop)    lines.push(<line key={`it${i}`} x1={x} y1={0} x2={x} y2={ROW_H / 2 - 5} stroke={col} strokeWidth={1.5} />);
      if (hasBottom) lines.push(<line key={`ib${i}`} x1={x} y1={ROW_H / 2 + 5} x2={x} y2={ROW_H} stroke={col} strokeWidth={1.5} />);
    } else {
      const topIsMine = commit.lanesTop[i] === commit.sha;
      if (hasTop && hasBottom && !topIsMine) {
        lines.push(<line key={`pt${i}`} x1={x} y1={0} x2={x} y2={ROW_H} stroke={col} strokeWidth={1.5} />);
      } else if (topIsMine && !hasBottom) {
        // This lane was also pointing at our commit — merge arc to myLane
        lines.push(<path key={`ma${i}`} d={`M${x},0 Q${x},${ROW_H/2} ${cx},${ROW_H/2}`} stroke={col} strokeWidth={1.5} fill="none"/>);
      } else if (!hasTop && hasBottom) {
        // New lane born from this commit — fork arc
        lines.push(<path key={`fa${i}`} d={`M${cx},${ROW_H/2} Q${x},${ROW_H/2} ${x},${ROW_H}`} stroke={col} strokeWidth={1.5} fill="none"/>);
      } else if (hasTop && hasBottom && topIsMine) {
        lines.push(<path key={`ca${i}`} d={`M${x},0 Q${x},${ROW_H/2} ${cx},${ROW_H/2}`} stroke={col} strokeWidth={1.5} fill="none"/>);
        lines.push(<line key={`cb${i}`} x1={x} y1={ROW_H/2} x2={x} y2={ROW_H} stroke={col} strokeWidth={1.5}/>);
      } else if (hasTop && !hasBottom) {
        lines.push(<line key={`te${i}`} x1={x} y1={0} x2={x} y2={ROW_H/2} stroke={col} strokeWidth={1.5}/>);
      }
    }
  }

  const isHead = commit.refs.some((r) => r.type === "head");
  const dotColor = lc(commit.lane);

  return (
    <div
      className={"gv-row" + (selected ? " selected" : "")}
      onClick={onSelect}
      onContextMenu={onCtx}
    >
      <svg className="gv-graph" width={W} height={ROW_H} style={{ minWidth: W }}>
        {lines}
        <circle cx={cx} cy={ROW_H / 2} r={isHead ? 5 : 3.5}
          fill={dotColor} stroke={selected ? "#fff" : dotColor} strokeWidth={isHead ? 1.5 : 0} />
      </svg>
      <div className="gv-msg">
        {commit.refs.map((r, i) => <RefBadge key={i} ref={r} />)}
        <span className="gv-subject">{commit.subject || "(no message)"}</span>
      </div>
      <span className="gv-author">{commit.author}</span>
      <span className="gv-date">{fmtDate(commit.date)}</span>
      <span className="gv-sha">{commit.short_sha}</span>
    </div>
  );
}

function CommitDetail({ commit }: { commit: GitCommit }) {
  return (
    <div className="gv-detail">
      <div className="gv-detail-header">
        <span className="gv-detail-sha">{commit.sha.slice(0, 12)}</span>
        <span className="gv-detail-author">{commit.author} &lt;{commit.email}&gt;</span>
        <span className="gv-detail-date">{fmtDate(commit.date)}</span>
      </div>
      <div className="gv-detail-msg">{commit.subject}</div>
      {commit.refs.length > 0 && (
        <div className="gv-detail-refs">
          {commit.refs.map((r, i) => <RefBadge key={i} ref={r} />)}
        </div>
      )}
      {commit.parents.length > 0 && (
        <div className="gv-detail-parents">
          Parents: {commit.parents.map((p) => p.slice(0, 8)).join(", ")}
        </div>
      )}
    </div>
  );
}

function FileRow({
  file, staged,
  onStage, onUnstage, onDiscard, onCtx,
}: {
  file: GitFileStatus;
  staged: boolean;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  onCtx: (e: React.MouseEvent) => void;
}) {
  const statusChar = staged ? file.index_status : file.worktree_status;
  const { letter, color } = statusStyle(statusChar);
  const name = file.path.split("/").pop() ?? file.path;
  const dir  = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";

  return (
    <div className="gc-file" onContextMenu={onCtx}>
      <span className="gc-status" style={{ color }}>{letter}</span>
      <span className="gc-name" title={file.path}>{name}</span>
      {dir && <span className="gc-dir">{dir}</span>}
      <span className="gc-file-actions">
        {staged ? (
          <button className="gc-btn" title="Unstage" onClick={onUnstage}>−</button>
        ) : (
          <>
            <button className="gc-btn" title="Stage" onClick={onStage}>+</button>
            <button className="gc-btn danger" title="Discard" onClick={onDiscard}>↺</button>
          </>
        )}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GitPanel() {
  // ─ shared state
  const [gStatus, setGStatus] = useState<GitStatus>();
  const [branches, setBranches] = useState<string[]>([]);
  const [remoteNames, setRemoteNames] = useState<string[]>([]);
  const [files, setFiles] = useState<GitFileStatus[]>([]);
  const [commits, setCommits] = useState<CommitWithLane[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [stashes, setStashes] = useState<string[]>([]);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [repoRoot, setRepoRoot] = useState("");
  const [studioClosed, setStudioClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [commitMsg, setCommitMsg] = useState("");
  const [stashMsg, setStashMsg] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [showCommitMenu, setShowCommitMenu] = useState(false);
  const [newBranchOpen, setNewBranchOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchStart, setNewBranchStart] = useState<string>();
  const [carryChanges, setCarryChanges] = useState(true);
  const [pushNewBranch, setPushNewBranch] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [terminalHistory, setTerminalHistory] = useState<string[]>([]);
  const [terminalHistoryIndex, setTerminalHistoryIndex] = useState(-1);
  const terminalOutputRef = useRef<HTMLDivElement>(null);

  // ─ graph tab state
  const [selectedSha, setSelectedSha] = useState<string>();
  const [ctxMenu, setCtxMenu] = useState<CtxMenu>();
  const [showLocal, setShowLocal] = useState(true);
  const [showRemote, setShowRemote] = useState(true);
  const [showTags, setShowTags] = useState(true);
  const commitMenuRef = useRef<HTMLDivElement>(null);

  const [branchCtx, setBranchCtx] = useState<CtxMenu>();

  const refresh = useCallback(async () => {
    try {
      const [s, b, f, t, w, stash] = await Promise.all([
        git.status(),
        git.branches(),
        git.fileStatus(),
        git.tags(),
        git.worktrees(),
        git.stashList(),
      ]);
      setGStatus(s);
      window.dispatchEvent(new CustomEvent("mrb:git-status", { detail: s }));
      setBranches(b.branches);
      setRemoteNames(b.remotes ?? []);
      setFiles(f.files);
      setTags(t.tags);
      setWorktrees(w.worktrees);
      setRepoRoot(w.root);
      setStashes(stash.stash);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }, []);

  const refreshGraph = useCallback(async () => {
    try {
      const { commits: raw } = await git.log(200);
      setCommits(computeLanes(raw));
    } catch {
      // graph is best-effort; don't overwrite other errors
    }
  }, []);

  useEffect(() => { void refresh(); void refreshGraph(); }, [refresh, refreshGraph]);

  // Keep the visual tree in sync when Git is used from this terminal or from
  // another CLI attached to the same working tree.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !busy) {
        void refresh();
        void refreshGraph();
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [busy, refresh, refreshGraph]);

  useEffect(() => {
    terminalOutputRef.current?.scrollTo({ top: terminalOutputRef.current.scrollHeight });
  }, [terminalEntries]);

  // Close commit dropdown on outside click
  useEffect(() => {
    if (!showCommitMenu) return;
    const handler = (e: MouseEvent) => {
      if (commitMenuRef.current && !commitMenuRef.current.contains(e.target as Node))
        setShowCommitMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCommitMenu]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
      setNotice(label);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      await refresh();
      void refreshGraph();
      setBusy(false);
    }
  };

  // ─ derived data
  const staged   = files.filter((f) => f.index_status !== " " && f.index_status !== "?");
  const unstaged = files.filter((f) => f.worktree_status !== " ");
  const local    = branches.filter((b) => !b.startsWith("origin/"));
  const remotes  = branches.filter((b) => b.startsWith("origin/"));
  const guard    = studioClosed && !busy;

  const visibleCommits = commits.filter((c) => {
    if (!showLocal && c.refs.some((r) => r.type === "local" || r.type === "head")) return false;
    if (!showRemote && c.refs.some((r) => r.type === "remote")) return false;
    if (!showTags && c.refs.some((r) => r.type === "tag")) return false;
    return true;
  });
  const maxLanes = visibleCommits.reduce((m, c) => Math.max(m, c.lane + 1), 1);
  const selectedCommit = commits.find((c) => c.sha === selectedSha);
  const contributors = [...new Set(commits.map((commit) => commit.author))];
  const repositoryName = repoRoot.split("/").pop() || "Repository";

  function openNewBranch(startPoint?: string) {
    setNewBranchName("");
    setNewBranchStart(startPoint);
    setCarryChanges(true);
    setPushNewBranch(false);
    setNewBranchOpen(true);
  }

  async function createNewBranch() {
    const name = newBranchName.trim();
    if (!name) return;
    setNewBranchOpen(false);
    await run(`Created branch ${name}`, async () => {
      await git.create(name, studioClosed, newBranchStart, carryChanges);
      if (pushNewBranch) await git.push();
    });
  }

  async function executeTerminalCommand() {
    const command = terminalInput.trim();
    if (!command || busy) return;
    const dangerous = /\b(reset\s+--hard|clean\s+-|branch\s+-D|stash\s+(drop|clear)|checkout\s+--)\b/i.test(command);
    if (dangerous && !window.confirm(`Run destructive command?\n\n${command}`)) return;

    setTerminalInput("");
    setTerminalHistory((history) => [...history, command]);
    setTerminalHistoryIndex(-1);
    setBusy(true);
    try {
      const result = await git.command(command, studioClosed);
      setTerminalEntries((entries) => [...entries, {
        command: result.command,
        output: result.output || "(command completed)",
      }]);
    } catch (e) {
      setTerminalEntries((entries) => [...entries, {
        command,
        output: String(e instanceof Error ? e.message : e),
        failed: true,
      }]);
    } finally {
      await refresh();
      await refreshGraph();
      setBusy(false);
    }
  }

  function addRemote() {
    const name = window.prompt("Remote name:", "origin")?.trim();
    if (!name) return;
    const url = window.prompt(`URL for remote “${name}”:`)?.trim();
    if (!url) return;
    void run(`Added remote ${name}`, () => git.addRemote(name, url));
  }

  function openCommitCtx(e: React.MouseEvent, commit: GitCommit) {
    e.preventDefault();
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "Cherry-pick",          action: () => run(`Cherry-picked ${commit.short_sha}`, () => git.cherryPick(commit.sha, studioClosed)) },
        { label: "Revert commit",        action: () => run(`Reverted ${commit.short_sha}`, () => git.revert(commit.sha, studioClosed)) },
        "sep",
        { label: "Reset (Soft) to here",  action: () => run(`Reset soft to ${commit.short_sha}`, () => git.reset(commit.sha, "soft", studioClosed)) },
        { label: "Reset (Mixed) to here", action: () => run(`Reset mixed to ${commit.short_sha}`, () => git.reset(commit.sha, "mixed", studioClosed)) },
        { label: "Reset (Hard) to here",  action: () => run(`Reset hard to ${commit.short_sha}`, () => git.reset(commit.sha, "hard", studioClosed)), danger: true },
        "sep",
        { label: "New branch from here...", action: () => openNewBranch(commit.sha) },
        { label: "Create tag here...", action: () => {
            const name = window.prompt("Tag name:");
            if (name?.trim()) run(`Created tag ${name}`, () => git.createTag(name.trim(), commit.sha));
          }
        },
        "sep",
        { label: "Copy SHA",  action: () => navigator.clipboard.writeText(commit.sha) },
        { label: "Copy Short SHA", action: () => navigator.clipboard.writeText(commit.short_sha) },
      ],
    });
  }

  function openBranchCtx(e: React.MouseEvent, branch: string) {
    e.preventDefault();
    const isCurrent = branch === gStatus?.branch;
    const checkoutBranch = branch.replace(/^origin\//, "");
    setBranchCtx({
      x: e.clientX, y: e.clientY,
      items: [
        !isCurrent && { label: `Checkout ${branch}`, action: () => run(`Checked out ${branch}`, () => git.switch(checkoutBranch, studioClosed)) },
        { label: `Merge ${branch} into current`, action: () => run(`Merged ${branch}`, () => git.merge(branch, studioClosed)) },
        "sep" as const,
        !isCurrent && { label: `Delete ${branch}`, action: () => { if (window.confirm(`Delete branch ${branch}?`)) run(`Deleted ${branch}`, () => git.deleteBranch(branch)); }, danger: true },
      ].filter(Boolean) as CtxMenu["items"],
    });
  }

  function openStashCtx(e: React.MouseEvent, stash: string) {
    e.preventDefault();
    const reference = stash.match(/^(stash@\{\d+\})/)?.[1];
    if (!reference) return;
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "Apply Stash", action: () => run(`Applied ${reference}`, () => git.stashApply(reference, false, studioClosed)) },
        { label: "Pop Stash", action: () => run(`Popped ${reference}`, () => git.stashApply(reference, true, studioClosed)) },
        "sep",
        {
          label: "Drop Stash",
          danger: true,
          action: () => {
            if (window.confirm(`Drop ${reference}?`))
              void run(`Dropped ${reference}`, () => git.stashDrop(reference));
          },
        },
      ],
    });
  }

  return (
    <div className="git-panel">
      <div className="git-head">
        <strong>Git Repository</strong>
        <span className="git-repo-path" title={repoRoot}>{repositoryName}</span>
        <span className="git-spacer" />
        <button className="git-icon-btn" title="Fetch" disabled={busy} onClick={() => run("Fetched", () => git.fetch())}>⇅</button>
        <button className="git-icon-btn" title="Pull" disabled={!guard} onClick={() => run("Pulled", () => git.pull(studioClosed))}>↓</button>
        <button className="git-icon-btn" title={remoteNames.length ? "Push" : "Add a remote before pushing"}
          disabled={busy || remoteNames.length === 0} onClick={() => run("Pushed", () => git.push())}>↑</button>
        <button className={"git-terminal-toggle" + (terminalOpen ? " active" : "")} title="Open Git terminal"
          onClick={() => setTerminalOpen((open) => !open)}><span>&gt;_</span> Terminal</button>
        <button className="git-icon-btn" title="Refresh" disabled={busy} onClick={() => { void refresh(); void refreshGraph(); }}>⟳</button>
      </div>
      {error && <div className="git-error">{error}</div>}
      {notice && <div className="git-notice">{notice}</div>}

      <div className="git-workspace">
        <aside className="git-sidebar">
          <div className="git-sidebar-title">SOURCE CONTROL</div>
          <div className="git-repository-row">
            <span>⌄</span><span className="git-ico">◇</span>
            <strong>{repositoryName}</strong>
            <span className="git-sidebar-count">{files.length}</span>
          </div>
          <label className="git-guard compact">
            <input type="checkbox" checked={studioClosed} onChange={(e) => setStudioClosed(e.target.checked)} />
            Studio Pro is closed
          </label>

          <textarea className="gc-commit-msg compact" placeholder="Message (Ctrl+Enter to commit)"
            value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} rows={2} />
          <div className="gc-commit-actions sidebar" ref={commitMenuRef}>
            <button className="gc-commit-btn" disabled={!guard || !commitMsg.trim() || staged.length === 0}
              onClick={() => run("Committed staged changes", () =>
                git.commitStaged(commitMsg.trim(), studioClosed).then(() => setCommitMsg("")))}>
              ✓ Commit Staged
            </button>
            <button className="gc-commit-arrow" disabled={!guard || !commitMsg.trim()}
              onClick={() => setShowCommitMenu((value) => !value)}>⌄</button>
            {showCommitMenu && (
              <div className="gc-commit-menu">
                <button onClick={() => run("Committed all changes", () =>
                  git.commit(commitMsg.trim(), studioClosed).then(() => setCommitMsg("")))}>Commit All</button>
                <button disabled={staged.length === 0 || remoteNames.length === 0}
                  onClick={() => run("Committed staged changes and pushed", () =>
                    git.commitStaged(commitMsg.trim(), studioClosed).then(() => git.push()).then(() => setCommitMsg("")))}>
                  Commit Staged and Push
                </button>
                <button disabled={remoteNames.length === 0} onClick={() => run("Committed and pushed", () =>
                  git.commit(commitMsg.trim(), studioClosed).then(() => git.push()).then(() => setCommitMsg("")))}>Commit All and Push</button>
              </div>
            )}
          </div>

          <div className="git-changes-scroll">
            <details open className="git-tree-section">
              <summary>STAGED CHANGES <span>{staged.length}</span></summary>
              {staged.length === 0 && <div className="gc-empty">No staged changes</div>}
              {staged.map((file) => <FileRow key={file.path} file={file} staged
                onStage={() => {}} onDiscard={() => {}}
                onUnstage={() => run(`Unstaged ${file.path}`, () => git.unstage(file.path))}
                onCtx={(e) => { e.preventDefault(); }} />)}
            </details>
            <details open className="git-tree-section">
              <summary>CHANGES <span>{unstaged.length}</span></summary>
              {unstaged.map((file) => <FileRow key={file.path} file={file} staged={false}
                onUnstage={() => {}}
                onStage={() => run(`Staged ${file.path}`, () => git.stage(file.path))}
                onDiscard={() => { if (window.confirm(`Discard ${file.path}?`)) void run(`Discarded ${file.path}`, () => git.discard(file.path)); }}
                onCtx={(e) => { e.preventDefault(); }} />)}
            </details>
          </div>

          <nav className="git-nav-tree">
            <details open><summary>REPOSITORIES <span>1</span></summary><div className="git-nav-item active">◇ {repositoryName}</div></details>
            <details><summary>COMMITS</summary><div className="git-nav-item">◉ {gStatus?.branch ?? "HEAD"}</div></details>
            <details><summary>BRANCHES <span>{local.length}</span>
              <button className="git-summary-action" title="Create branch"
                onClick={(event) => { event.preventDefault(); event.stopPropagation(); openNewBranch(); }}>＋</button>
            </summary>
              <button className="git-nav-command" onClick={() => openNewBranch()}>＋ Create new branch…</button>
              {local.map((branch) => <div key={branch} className={"git-nav-item" + (branch === gStatus?.branch ? " active" : "")}
                onContextMenu={(e) => openBranchCtx(e, branch)}>⎇ {branch}</div>)}
            </details>
            <details><summary>REMOTES <span>{remoteNames.length}</span>
              <button className="git-summary-action" title="Add remote"
                onClick={(event) => { event.preventDefault(); event.stopPropagation(); addRemote(); }}>＋</button>
            </summary>
              {remoteNames.length === 0 && <button className="git-nav-command" onClick={addRemote}>＋ Add remote…</button>}
              {remoteNames.map((remote) => <div className="git-nav-item" key={`remote-${remote}`}>☁ {remote}</div>)}
              {remotes.map((branch) => <div key={branch} className="git-nav-item muted" onContextMenu={(e) => openBranchCtx(e, branch)}>☁ {branch}</div>)}
            </details>
            <details><summary>STASHES <span>{stashes.length}</span></summary>
              <div className="git-stash-create">
                <input value={stashMsg} onChange={(e) => setStashMsg(e.target.value)}
                  placeholder="Stash message (optional)" />
                <label><input type="checkbox" checked={includeUntracked}
                  onChange={(e) => setIncludeUntracked(e.target.checked)} /> Include untracked</label>
                <button disabled={!guard || files.length === 0}
                  onClick={() => run("Changes stashed", () =>
                    git.stashPush(stashMsg.trim(), includeUntracked, studioClosed)
                      .then(() => setStashMsg("")))}>
                  Stash Changes
                </button>
              </div>
              {stashes.length === 0 && <div className="git-nav-empty">No stashes</div>}
              {stashes.map((stash) => <div key={stash} className="git-nav-item" title={`${stash} — right-click for actions`}
                onContextMenu={(e) => openStashCtx(e, stash)}>▣ {stash}</div>)}
            </details>
            <details><summary>TAGS <span>{tags.length}</span></summary>
              {tags.map((tag) => <div key={tag} className="git-nav-item">◆ {tag}</div>)}
            </details>
            <details open><summary>WORKTREES <span>{worktrees.length}</span></summary>
              {worktrees.map((worktree) => <div key={worktree.path} className="git-worktree-item">
                <span>▱</span><span><strong>{worktree.branch ?? "detached"}</strong><small>{worktree.path}</small></span>
              </div>)}
            </details>
            <details><summary>CONTRIBUTORS <span>{contributors.length}</span></summary>
              {contributors.map((author) => <div key={author} className="git-nav-item">○ {author}</div>)}
            </details>
          </nav>
        </aside>

        <section className="git-history">
          <div className="git-history-head">
            <div><strong>{gStatus?.branch ?? "History"}</strong><small>{repoRoot}</small></div>
            <span className={gStatus?.clean ? "git-pill clean" : "git-pill dirty"}>
              {gStatus?.clean ? "clean" : `${files.length} changes`}
            </span>
          </div>
          <div className="gv-toolbar">
            <span className="git-filter-icon">⌕</span>
            <input className="git-log-filter" placeholder="Filter commits" />
            <button className={"gv-tb-btn" + (showLocal ? " active" : "")} onClick={() => setShowLocal(!showLocal)}>Branch: All</button>
            <button className={"gv-tb-btn" + (showRemote ? " active" : "")} onClick={() => setShowRemote(!showRemote)}>Remotes</button>
            <button className={"gv-tb-btn" + (showTags ? " active" : "")} onClick={() => setShowTags(!showTags)}>Tags</button>
          </div>
          <div className="gv-panel">
            <div className="gv-list">
              <div className="gv-list-header">
                <span style={{ minWidth: maxLanes * LANE_W + LANE_W }} />
                <span className="gv-col-msg">Commit</span><span className="gv-col-author">Author</span>
                <span className="gv-col-date">Date</span><span className="gv-col-sha">Hash</span>
              </div>
              <div className="gv-rows">
                {visibleCommits.map((commit) => <GraphRow key={commit.sha} commit={commit}
                  maxLanes={maxLanes} selected={selectedSha === commit.sha}
                  onSelect={() => setSelectedSha(commit.sha === selectedSha ? undefined : commit.sha)}
                  onCtx={(e) => openCommitCtx(e, commit)} />)}
              </div>
            </div>
            {selectedCommit && <CommitDetail commit={selectedCommit} />}
          </div>
        </section>
      </div>

      {terminalOpen && (
        <section className="git-terminal">
          <div className="git-terminal-head">
            <strong>Git Terminal</strong>
            <span>{repoRoot}</span>
            <span className="git-spacer" />
            <button onClick={() => setTerminalEntries([])}>Clear</button>
            <button onClick={() => setTerminalOpen(false)}>×</button>
          </div>
          <div className="git-terminal-output" ref={terminalOutputRef}>
            {terminalEntries.length === 0 && (
              <div className="git-terminal-hint">Git CLI for this repository. Commands that change files require “Studio Pro is closed”.</div>
            )}
            {terminalEntries.map((entry, index) => (
              <div className={entry.failed ? "git-terminal-entry failed" : "git-terminal-entry"} key={`${entry.command}-${index}`}>
                <div><span className="git-terminal-prompt">$</span> {entry.command}</div>
                <pre>{entry.output}</pre>
              </div>
            ))}
          </div>
          <div className="git-terminal-input-row">
            <span>{repositoryName}:{gStatus?.branch ?? "HEAD"} $</span>
            <input autoFocus value={terminalInput} disabled={busy} placeholder="git status"
              onChange={(event) => setTerminalInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void executeTerminalCommand();
                if (event.key === "ArrowUp" && terminalHistory.length) {
                  event.preventDefault();
                  const next = terminalHistoryIndex < 0
                    ? terminalHistory.length - 1
                    : Math.max(0, terminalHistoryIndex - 1);
                  setTerminalHistoryIndex(next);
                  setTerminalInput(terminalHistory[next]);
                }
                if (event.key === "ArrowDown" && terminalHistoryIndex >= 0) {
                  event.preventDefault();
                  const next = terminalHistoryIndex + 1;
                  setTerminalHistoryIndex(next >= terminalHistory.length ? -1 : next);
                  setTerminalInput(next >= terminalHistory.length ? "" : terminalHistory[next]);
                }
              }} />
          </div>
        </section>
      )}

      {newBranchOpen && (
        <div className="git-modal-backdrop" onMouseDown={() => setNewBranchOpen(false)}>
          <div className="git-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header><strong>Create a new branch</strong><button onClick={() => setNewBranchOpen(false)}>×</button></header>
            <label className="git-modal-field">Branch name
              <input autoFocus value={newBranchName} onChange={(event) => setNewBranchName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void createNewBranch(); }}
                placeholder="feature/my-change" />
            </label>
            <div className="git-modal-base">Based on <strong>{newBranchStart?.slice(0, 8) ?? gStatus?.branch ?? "HEAD"}</strong></div>
            {!gStatus?.clean && (
              <fieldset>
                <legend>Uncommitted changes</legend>
                <label><input type="radio" checked={carryChanges} onChange={() => setCarryChanges(true)} />
                  Carry changes to the new branch</label>
                <label><input type="radio" checked={!carryChanges} onChange={() => setCarryChanges(false)} />
                  Keep the new branch clean and save changes in a stash</label>
              </fieldset>
            )}
            <label className="git-modal-check"><input type="checkbox" checked={pushNewBranch}
              disabled={remoteNames.length === 0}
              onChange={(event) => setPushNewBranch(event.target.checked)} /> Push the new branch to origin</label>
            {remoteNames.length === 0 && (
              <div className="git-modal-warning">No Git remote is configured. Add an origin under REMOTES before pushing.</div>
            )}
            <label className="git-modal-check studio-confirm"><input type="checkbox" checked={studioClosed}
              onChange={(event) => setStudioClosed(event.target.checked)} />
              I confirm that Studio Pro is closed</label>
            <footer>
              <button onClick={() => setNewBranchOpen(false)}>Cancel</button>
              <button className="primary" disabled={!newBranchName.trim() || !guard}
                onClick={() => void createNewBranch()}>Create branch</button>
            </footer>
          </div>
        </div>
      )}

      {ctxMenu && <ContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(undefined)} />}
      {branchCtx && <ContextMenu ctx={branchCtx} onClose={() => setBranchCtx(undefined)} />}
    </div>
  );
}
