import { useEffect, useState } from "react";
import { applyDraft } from "../model/api";
import type { BackendHealth } from "../model/types";

// Lists the reviewable drafts saved by the visual builders (entity plans and
// page plans). Drafts are inventory sidecars; valid ones can be applied to the
// source .mpr via the guarded workflow (Studio Pro must be closed).

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

interface EntityDraft {
  saved_at?: string;
  result?: { ok?: boolean; blocked?: boolean; mdl?: string; operation?: { action?: string; reason?: string } };
}

interface PageDraft {
  saved_at?: string;
  valid?: boolean;
  message?: string;
  mdl?: string;
}

interface DraftsPayload {
  entities: Record<string, EntityDraft>;
  pages: Record<string, PageDraft>;
  flows?: Record<string, PageDraft>;
}

function loadDrafts(): Promise<DraftsPayload> {
  return fetch(`${BASE}/drafts`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
}

export default function Drafts({
  onOpen,
  health,
}: {
  onOpen: (qn: string) => void;
  health?: BackendHealth;
}) {
  const [data, setData] = useState<DraftsPayload>();
  const [error, setError] = useState<string>();
  const [applying, setApplying] = useState<string>();
  const [applyMsg, setApplyMsg] = useState<{ qn: string; ok: boolean; msg: string }>();
  const canApply = health?.capabilities?.apply_drafts ?? false;

  useEffect(() => {
    loadDrafts().then(setData).catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="empty pad">Drafts unavailable: {error}</p>;
  if (!data) return <p className="empty pad">Loading drafts…</p>;

  const entities = Object.entries(data.entities);
  const pages = Object.entries(data.pages);

  const handleApply = async (qn: string, type: "page" | "flow") => {
    if (!confirm(`Apply this ${type} draft to the Mendix project?\n\nMake sure Studio Pro is closed before confirming.`)) return;
    setApplying(qn);
    setApplyMsg(undefined);
    const result = await applyDraft(qn, type, true);
    setApplying(undefined);
    setApplyMsg({ qn, ok: result.ok, msg: result.message ?? (result.ok ? "Applied." : "Failed.") });
    if (result.ok) loadDrafts().then(setData).catch(() => null);
  };

  const card = (
    qn: string,
    type: "page" | "flow" | "entity",
    saved: string | undefined,
    ok: boolean,
    note: string | undefined,
    mdl: string | undefined,
  ) => (
    <div className="draft-card" key={qn}>
      <div className="draft-head">
        <a className="ref" onClick={() => onOpen(qn)}>{qn}</a>
        <span className={ok ? "git-tag clean" : "git-tag dirty"}>{ok ? "valid" : "blocked"}</span>
        {saved && <span className="draft-when">{new Date(saved).toLocaleString()}</span>}
        {canApply && type !== "entity" && ok && (
          <button
            className="w-btn"
            disabled={applying === qn}
            onClick={() => handleApply(qn, type)}
          >
            {applying === qn ? "Applying…" : "Apply"}
          </button>
        )}
      </div>
      {applyMsg?.qn === qn && (
        <div className={applyMsg.ok ? "draft-note" : "draft-note draft-note-error"}>
          {applyMsg.msg}
        </div>
      )}
      {note && <div className="draft-note">{note}</div>}
      {mdl && (
        <details>
          <summary>MDL</summary>
          <pre>{mdl}</pre>
        </details>
      )}
    </div>
  );

  return (
    <div className="drafts">
      <p className="draft-hint">
        Drafts are validated previews saved by the visual editors.
        {canApply
          ? " Valid drafts can be applied to the source project directly — Studio Pro must be closed."
          : " Applying them to the project requires the guarded CLI workflow (mxcli exec / mendix-apply)."}
      </p>

      <h3>Page drafts</h3>
      {pages.length === 0 && <p className="empty">No page drafts yet — use "Save page" in the page builder.</p>}
      {pages.map(([qn, d]) => card(qn, "page", d.saved_at, d.valid !== false, d.message, d.mdl))}

      <h3>Flow drafts</h3>
      {Object.keys(data.flows ?? {}).length === 0 && (
        <p className="empty">No flow drafts yet — use "Save flow" in the microflow editor.</p>
      )}
      {Object.entries(data.flows ?? {}).map(([qn, d]) =>
        card(qn, "flow", d.saved_at, d.valid !== false, d.message, d.mdl),
      )}

      <h3>Entity drafts</h3>
      {entities.length === 0 && <p className="empty">No entity drafts yet — use "Edit entity" on a parsed entity.</p>}
      {entities.map(([qn, d]) =>
        card(qn, "entity", d.saved_at, !d.result?.blocked, d.result?.operation?.reason, d.result?.mdl),
      )}
    </div>
  );
}
