import { useCallback, useEffect, useState } from "react";
import { git, type GitStatus } from "../model/api";

// Guarded Git panel: branch switch/create, stash, and commit for the imported
// Mendix project. Every mutation goes through the backend GitWorkflow, which
// refuses to touch a dirty tree and requires confirming Studio Pro is closed
// (it locks the .mpr). We surface backend errors verbatim rather than hiding them.
export default function GitPanel() {
  const [status, setStatus] = useState<GitStatus>();
  const [branches, setBranches] = useState<string[]>([]);
  const [stashes, setStashes] = useState<string[]>([]);
  const [studioClosed, setStudioClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const [newBranch, setNewBranch] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [stashMessage, setStashMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, b, st] = await Promise.all([git.status(), git.branches(), git.stashList()]);
      setStatus(s);
      setBranches(b.branches);
      setStashes(st.stash);
      setError(undefined);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Runs a guarded action, then refreshes state and reports success/failure.
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
      setBusy(false);
    }
  };

  const local = branches.filter((b) => !b.startsWith("origin/"));
  const remotes = branches.filter((b) => b.startsWith("origin/"));
  const guardReady = studioClosed && !busy;

  return (
    <div className="git-panel">
      <div className="git-head">
        <div className="git-current">
          <span className="git-branch">
            <span className="git-ico">⎇</span>
            {status ? status.branch : "…"}
          </span>
          {status && (
            <span className={status.clean ? "git-tag clean" : "git-tag dirty"}>
              {status.clean ? "clean" : "uncommitted changes"}
            </span>
          )}
          {status?.operation_in_progress && (
            <span className="git-tag dirty">{status.operation_in_progress} in progress</span>
          )}
        </div>
        <button className="w-btn" onClick={refresh} disabled={busy}>
          Refresh
        </button>
      </div>

      <label className="git-guard">
        <input
          type="checkbox"
          checked={studioClosed}
          onChange={(e) => setStudioClosed(e.target.checked)}
        />
        Studio Pro is closed (required — it locks the .mpr while open)
      </label>

      {error && <div className="git-error">{error}</div>}
      {notice && <div className="git-notice">{notice}</div>}

      <section className="git-section">
        <h3>Branches</h3>
        <form
          className="git-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newBranch.trim()) return;
            run(`Created and switched to ${newBranch.trim()}`, () =>
              git.create(newBranch.trim(), studioClosed),
            ).then(() => setNewBranch(""));
          }}
        >
          <input
            placeholder="new-branch-name"
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
          />
          <button className="w-btn" type="submit" disabled={!guardReady || !newBranch.trim()}>
            Create branch
          </button>
          <button
            className="w-btn"
            type="button"
            disabled={busy}
            onClick={() => run("Fetched from origin", () => git.fetch())}
          >
            Fetch
          </button>
        </form>

        <ul className="git-list">
          {local.map((b) => (
            <li key={b} className={b === status?.branch ? "on" : ""}>
              <span>{b}</span>
              {b === status?.branch ? (
                <span className="git-hint">current</span>
              ) : (
                <button
                  className="w-btn"
                  disabled={!guardReady}
                  onClick={() => run(`Switched to ${b}`, () => git.switch(b, studioClosed))}
                >
                  Switch
                </button>
              )}
            </li>
          ))}
          {remotes.map((b) => (
            <li key={b} className="remote">
              <span>{b}</span>
              <button
                className="w-btn"
                disabled={!guardReady}
                onClick={() =>
                  run(`Checked out ${b.replace(/^origin\//, "")}`, () =>
                    git.switch(b.replace(/^origin\//, ""), studioClosed),
                  )
                }
              >
                Check out
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="git-section">
        <h3>Commit</h3>
        <form
          className="git-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (!commitMessage.trim()) return;
            run("Committed the project changes", () =>
              git.commit(commitMessage.trim(), studioClosed),
            ).then(() => setCommitMessage(""));
          }}
        >
          <input
            placeholder="Commit message"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
          />
          <button
            className="w-btn"
            type="submit"
            disabled={!guardReady || !commitMessage.trim() || status?.clean}
          >
            Commit
          </button>
        </form>
        {status?.clean && <p className="git-hint pad">Nothing to commit — the working tree is clean.</p>}
      </section>

      <section className="git-section">
        <h3>Stash</h3>
        <form
          className="git-inline"
          onSubmit={(e) => {
            e.preventDefault();
            run("Stashed the working changes", () =>
              git.stashPush(stashMessage.trim(), includeUntracked, studioClosed),
            ).then(() => setStashMessage(""));
          }}
        >
          <input
            placeholder="Stash message (optional)"
            value={stashMessage}
            onChange={(e) => setStashMessage(e.target.value)}
          />
          <label className="git-hint">
            <input
              type="checkbox"
              checked={includeUntracked}
              onChange={(e) => setIncludeUntracked(e.target.checked)}
            />
            include untracked
          </label>
          <button className="w-btn" type="submit" disabled={!guardReady || status?.clean}>
            Stash push
          </button>
        </form>

        <ul className="git-list">
          {stashes.map((entry) => {
            const reference = entry.match(/^(stash@\{\d+\})/)?.[1] ?? "stash@{0}";
            return (
              <li key={entry}>
                <span className="git-stash">{entry}</span>
                <span className="git-actions">
                  <button
                    className="w-btn"
                    disabled={!guardReady}
                    onClick={() =>
                      run(`Applied ${reference}`, () => git.stashApply(reference, false, studioClosed))
                    }
                  >
                    Apply
                  </button>
                  <button
                    className="w-btn"
                    disabled={!guardReady}
                    onClick={() =>
                      run(`Popped ${reference}`, () => git.stashApply(reference, true, studioClosed))
                    }
                  >
                    Pop
                  </button>
                  <button
                    className="w-btn danger"
                    disabled={busy}
                    onClick={() => run(`Dropped ${reference}`, () => git.stashDrop(reference))}
                  >
                    Drop
                  </button>
                </span>
              </li>
            );
          })}
          {!stashes.length && <li className="git-empty">No stashed changes.</li>}
        </ul>
      </section>
    </div>
  );
}
