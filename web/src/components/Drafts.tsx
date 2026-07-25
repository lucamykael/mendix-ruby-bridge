import { useEffect, useState } from "react";

// Lists the reviewable drafts saved by the visual builders (entity plans and
// page plans). Drafts are inventory sidecars; applying them stays in the
// guarded CLI workflow, so this view is read-only with copyable MDL.

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

export default function Drafts({ onOpen }: { onOpen: (qn: string) => void }) {
  const [data, setData] = useState<DraftsPayload>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetch(`${BASE}/drafts`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="empty pad">Drafts unavailable: {error}</p>;
  if (!data) return <p className="empty pad">Loading drafts…</p>;

  const entities = Object.entries(data.entities);
  const pages = Object.entries(data.pages);

  const card = (
    qn: string,
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
      </div>
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
        Drafts are validated previews saved by the visual editors. Applying them to the
        project stays in the guarded CLI workflow (mxcli exec / mendix-apply).
      </p>

      <h3>Page drafts</h3>
      {pages.length === 0 && <p className="empty">No page drafts yet — use "Save page" in the page builder.</p>}
      {pages.map(([qn, d]) => card(qn, d.saved_at, d.valid !== false, d.message, d.mdl))}

      <h3>Flow drafts</h3>
      {Object.keys(data.flows ?? {}).length === 0 && (
        <p className="empty">No flow drafts yet — use "Save flow" in the microflow editor.</p>
      )}
      {Object.entries(data.flows ?? {}).map(([qn, d]) =>
        card(qn, d.saved_at, d.valid !== false, d.message, d.mdl),
      )}

      <h3>Entity drafts</h3>
      {entities.length === 0 && <p className="empty">No entity drafts yet — use "Edit entity" on a parsed entity.</p>}
      {entities.map(([qn, d]) =>
        card(qn, d.saved_at, !d.result?.blocked, d.result?.operation?.reason, d.result?.mdl),
      )}
    </div>
  );
}
