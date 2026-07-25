import { useState } from "react";

// Read-only data query panel. OQL runs against the running Mendix app (M2EE
// admin API, rollback mode); SQL runs against the configured database. Neither
// requires a marketplace login — OQL is a built-in Mendix query language.

type Engine = "oql" | "sql";

interface QueryResult {
  ok?: boolean;
  engine?: Engine;
  rows?: Array<Record<string, unknown>>;
  count?: number;
  message?: string;
  error?: string;
}

const PLACEHOLDER: Record<Engine, string> = {
  oql: "SELECT Name, Email FROM MyFirstModule.Customer",
  sql: "SELECT * FROM customer LIMIT 50",
};

// Best-effort OQL⇄SQL conversion. The two languages differ mainly in how they
// name the source: OQL uses `Module.Entity`, SQL the database table (the
// lowercased entity name). We rewrite FROM/JOIN targets using the inventory's
// entity list and leave the rest untouched — always review before running.
function convertQuery(query: string, from: Engine, entities: string[]): string {
  // Map: table name (lowercased entity) -> Module.Entity, and the reverse.
  const toQn = new Map<string, string>();
  const toTable = new Map<string, string>();
  for (const qn of entities) {
    const entity = qn.split(".").pop() ?? qn;
    toQn.set(entity.toLowerCase(), qn);
    toTable.set(qn.toLowerCase(), entity.toLowerCase());
  }

  if (from === "oql") {
    // Module.Entity -> table
    return query.replace(/\b([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\b/g, (match, mod, ent) => {
      const table = toTable.get(`${mod}.${ent}`.toLowerCase());
      return table ?? match;
    });
  }
  // SQL -> OQL: rewrite the identifier right after FROM/JOIN.
  return query.replace(/\b(FROM|JOIN)\s+("?)([A-Za-z_][\w]*)\2/gi, (match, kw, _q, table) => {
    const qn = toQn.get(table.toLowerCase());
    return qn ? `${kw} ${qn}` : match;
  });
}

export default function QueryPanel({ entities = [] }: { entities?: string[] }) {
  const [engine, setEngine] = useState<Engine>("oql");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!query.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    setRows(undefined);
    try {
      const r = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine, query }),
      });
      const body = (await r.json()) as QueryResult;
      if (r.ok && body.ok) {
        setRows(body.rows ?? []);
      } else {
        setError(body.message ?? body.error ?? `HTTP ${r.status}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const convert = () => {
    const other: Engine = engine === "oql" ? "sql" : "oql";
    if (query.trim()) setQuery(convertQuery(query, engine, entities));
    setEngine(other);
  };

  const columns = rows && rows.length ? Object.keys(rows[0]) : [];

  return (
    <div className="detail-drawer query-pane">
      <div className="query-bar">
        <div className="query-engine">
          <button className={engine === "oql" ? "on" : ""} onClick={() => setEngine("oql")}>OQL</button>
          <button className={engine === "sql" ? "on" : ""} onClick={() => setEngine("sql")}>SQL</button>
          <button
            className="query-convert"
            title={`Convert this query to ${engine === "oql" ? "SQL" : "OQL"} (best-effort — review before running)`}
            onClick={convert}
          >⇄ {engine === "oql" ? "to SQL" : "to OQL"}</button>
        </div>
        <textarea
          className="query-input"
          value={query}
          placeholder={PLACEHOLDER[engine]}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void run(); }
          }}
        />
        <button className="w-btn query-run" disabled={busy || !query.trim()} onClick={() => void run()}>
          {busy ? "Running…" : "▶ Run"}
        </button>
      </div>
      <div className="query-hint">
        {engine === "oql"
          ? "Runs read-only against the running app (M2EE admin API). Ctrl/⌘+Enter to run."
          : "Runs against the configured database (Settings). Ctrl/⌘+Enter to run."}
      </div>

      {error && <div className="query-error">{error}</div>}

      {rows && (
        rows.length === 0 ? (
          <p className="muted query-empty">No rows.</p>
        ) : (
          <div className="query-result">
            <table className="query-table">
              <thead>
                <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {columns.map((c) => <td key={c}>{formatCell(row[c])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="query-count">{rows.length} row{rows.length === 1 ? "" : "s"}</div>
          </div>
        )
      )}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
