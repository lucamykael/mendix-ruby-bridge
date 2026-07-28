import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

interface SqlResult {
  rows: Array<Record<string, unknown>>;
  elapsed: number;
}

interface Script {
  id: number;
  name: string;
  sql: string;
}

interface SqlCatalogTable {
  module: string;
  entity: string;
  physicalName: string;
  columns: string[];
}

interface Suggestion {
  value: string;
  label: string;
  detail: string;
  kind: "schema" | "table" | "column" | "keyword";
}

const STORAGE_KEY = "mrb-sql-scripts";
const SQL_KEYWORDS = /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|ON|AS|AND|OR|NOT|NULL|IS|IN|EXISTS|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|ALTER|DROP|TABLE|VIEW|CASE|WHEN|THEN|ELSE|END|ASC|DESC|COUNT|SUM|AVG|MIN|MAX)\b/gi;

function loadScripts(): Script[] {
  try {
    const scripts = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (Array.isArray(scripts) && scripts.length) return scripts;
  } catch {
    // Start with a clean editor when old local state is malformed.
  }
  return [{ id: Date.now(), name: "SQL Script 1", sql: "SELECT *\nFROM " }];
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function formatSql(sql: string): string {
  return sql
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*/g, ";\n")
    .replace(/\b(SELECT|FROM|WHERE|LEFT JOIN|RIGHT JOIN|INNER JOIN|FULL JOIN|JOIN|GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|UNION|VALUES|SET)\b/gi, "\n$1")
    .replace(/\b(AND|OR)\b/gi, "\n  $1")
    .trim()
    .replace(SQL_KEYWORDS, (keyword) => keyword.toUpperCase());
}

function highlightSql(sql: string): ReactNode[] {
  const tokenPattern = /(--[^\n]*|'(?:''|[^'])*'|\b\d+(?:\.\d+)?\b|\b(?:SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|ON|AS|AND|OR|NOT|NULL|IS|IN|EXISTS|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|ALTER|DROP|TABLE|VIEW|CASE|WHEN|THEN|ELSE|END|ASC|DESC|COUNT|SUM|AVG|MIN|MAX)\b)/gi;
  return sql.split(tokenPattern).map((token, index) => {
    if (/^--/.test(token)) return <span className="sql-comment" key={index}>{token}</span>;
    if (/^'/.test(token)) return <span className="sql-string" key={index}>{token}</span>;
    if (/^\d/.test(token)) return <span className="sql-number" key={index}>{token}</span>;
    if (SQL_KEYWORDS.test(token)) {
      SQL_KEYWORDS.lastIndex = 0;
      return <span className="sql-keyword" key={index}>{token}</span>;
    }
    SQL_KEYWORDS.lastIndex = 0;
    return token;
  });
}

export default function SqlEditor({ insertSql, catalog = [] }: { insertSql?: string; catalog?: SqlCatalogTable[] }) {
  const [scripts, setScripts] = useState<Script[]>(loadScripts);
  const [activeId, setActiveId] = useState(() => loadScripts()[0].id);
  const [result, setResult] = useState<SqlResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<"unknown" | "connected" | "disconnected">("unknown");
  const [editorScroll, setEditorScroll] = useState({ top: 0, left: 0 });
  const [editorFocused, setEditorFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastInsertedSql = useRef<string | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggestionRange, setSuggestionRange] = useState({ start: 0, end: 0 });

  const active = scripts.find((script) => script.id === activeId) ?? scripts[0];
  const activeScriptId = active?.id;
  const columns = useMemo(
    () => result?.rows.length ? Object.keys(result.rows[0]) : [],
    [result],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
  }, [scripts]);

  useEffect(() => {
    if (!insertSql || !activeScriptId || insertSql === lastInsertedSql.current) return;
    lastInsertedSql.current = insertSql;
    setScripts((all) => all.map((script) =>
      script.id === activeScriptId ? { ...script, sql: insertSql } : script));
  }, [insertSql, activeScriptId]);

  const updateSql = (sql: string) =>
    setScripts((all) => all.map((script) => script.id === active.id ? { ...script, sql } : script));

  const openAutocomplete = (caret: number, sql = active.sql) => {
    const before = sql.slice(0, caret);
    const token = before.match(/[A-Za-z_][\w$]*$/)?.[0] ?? "";
    const start = caret - token.length;
    const tableContext = /\b(?:FROM|JOIN|UPDATE|INTO)\s+[A-Za-z_\w$]*$/i.test(before);
    const tables: Suggestion[] = catalog.map((table) => ({
      value: table.physicalName,
      label: table.entity,
      detail: `${table.module}.${table.entity} · ${table.physicalName}`,
      kind: "table",
    }));
    const columns: Suggestion[] = catalog.flatMap((table) =>
      table.columns.map((column) => ({
        value: column,
        label: column,
        detail: table.entity,
        kind: "column" as const,
      })));
    const keywords: Suggestion[] = [
      "SELECT", "FROM", "WHERE", "JOIN", "LEFT JOIN", "INNER JOIN", "ON", "AND", "OR",
      "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "INSERT INTO", "UPDATE", "DELETE FROM",
      "COUNT", "SUM", "AVG", "MIN", "MAX", "DISTINCT",
    ].map((keyword) => ({ value: keyword, label: keyword, detail: "SQL keyword", kind: "keyword" as const }));
    const schemas: Suggestion[] = [
      { value: "public", label: "public", detail: "PostgreSQL schema", kind: "schema" },
      ...[...new Set(catalog.map((table) => table.module))].map((module) => ({
        value: module,
        label: module,
        detail: "Mendix module namespace",
        kind: "schema" as const,
      })),
    ];
    const candidates = tableContext ? tables : [...columns, ...tables, ...schemas, ...keywords];
    const query = token.toLowerCase();
    const unique = new Map<string, Suggestion>();
    candidates.forEach((suggestion) => {
      if (!query || suggestion.label.toLowerCase().includes(query) || suggestion.value.toLowerCase().includes(query))
        unique.set(`${suggestion.kind}:${suggestion.value}`, suggestion);
    });
    setSuggestionRange({ start, end: caret });
    setSuggestions([...unique.values()].slice(0, 120));
    setSuggestionIndex(0);
  };

  const applySuggestion = (suggestion: Suggestion) => {
    const next = active.sql.slice(0, suggestionRange.start) + suggestion.value + active.sql.slice(suggestionRange.end);
    const caret = suggestionRange.start + suggestion.value.length;
    updateSql(next);
    setSuggestions([]);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  };

  const newScript = () => {
    const id = Date.now();
    const script = { id, name: `SQL Script ${scripts.length + 1}`, sql: "" };
    setScripts((all) => [...all, script]);
    setActiveId(id);
    setResult(undefined);
    setError(undefined);
  };

  const closeScript = (id: number) => {
    if (scripts.length === 1) {
      updateSql("");
      return;
    }
    const index = scripts.findIndex((script) => script.id === id);
    const next = scripts.filter((script) => script.id !== id);
    setScripts(next);
    if (id === activeId) setActiveId(next[Math.max(0, index - 1)].id);
  };

  const run = async () => {
    if (!active?.sql.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    const started = performance.now();
    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine: "sql", query: active.sql }),
      });
      const body = await response.json() as {
        ok?: boolean;
        rows?: Array<Record<string, unknown>>;
        message?: string;
        error?: string;
      };
      if (!response.ok || !body.ok) throw new Error(body.message ?? body.error ?? `HTTP ${response.status}`);
      setResult({ rows: body.rows ?? [], elapsed: performance.now() - started });
      setConnection("connected");
    } catch (reason) {
      setResult(undefined);
      const message = String(reason instanceof Error ? reason.message : reason);
      setError(message);
      if (/connection refused|failed to connect|failed to ping|database.*unavailable/i.test(message))
        setConnection("disconnected");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="db-sql-editor">
      <div className="db-editor-tabs">
        {scripts.map((script) => (
          <button key={script.id} className={script.id === active?.id ? "active" : ""}
            onClick={() => setActiveId(script.id)}>
            <span className="db-sql-icon">SQL</span>{script.name}
            <span className="db-tab-close" onClick={(event) => { event.stopPropagation(); closeScript(script.id); }}>×</span>
          </button>
        ))}
        <button className="db-new-script" title="New SQL script" onClick={newScript}>＋</button>
      </div>
      <div className="db-sql-toolbar">
        <button className="db-run" disabled={busy || !active?.sql.trim()} onClick={() => void run()}>▶ Execute SQL</button>
        <button disabled={busy || !active?.sql.trim()} onClick={() => void run()} title="Execute script">▤ Execute script</button>
        <span className="db-toolbar-sep" />
        <button onClick={() => updateSql(formatSql(active.sql))}>Format SQL</button>
        <span className={`db-sql-connection ${connection}`}>
          ● {connection === "connected" ? "connected" : connection === "disconnected" ? "database offline" : "configured database"}
        </span>
      </div>
      <div className="db-sql-source">
        <div className="db-line-numbers">
          {active.sql.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}
        </div>
        <div className={`db-code-editor${editorFocused ? " focused" : ""}`}>
          <pre aria-hidden style={{ transform: `translate(${-editorScroll.left}px, ${-editorScroll.top}px)` }}>
            <code>{highlightSql(active.sql)}{"\n"}</code>
          </pre>
          <textarea ref={textareaRef} value={active.sql} spellCheck={false} aria-label="SQL script"
          onFocus={() => setEditorFocused(true)}
          onBlur={() => setEditorFocused(false)}
          onChange={(event) => {
            const sql = event.target.value;
            const caret = event.target.selectionStart;
            updateSql(sql);
            if (suggestions.length) openAutocomplete(caret, sql);
          }}
          onScroll={(event) => setEditorScroll({
            top: event.currentTarget.scrollTop,
            left: event.currentTarget.scrollLeft,
          })}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.code === "Space") {
              event.preventDefault();
              openAutocomplete(event.currentTarget.selectionStart);
              return;
            }
            if (suggestions.length && event.key === "ArrowDown") {
              event.preventDefault();
              setSuggestionIndex((index) => Math.min(suggestions.length - 1, index + 1));
              return;
            }
            if (suggestions.length && event.key === "ArrowUp") {
              event.preventDefault();
              setSuggestionIndex((index) => Math.max(0, index - 1));
              return;
            }
            if (suggestions.length && (event.key === "Enter" || event.key === "Tab")) {
              event.preventDefault();
              applySuggestion(suggestions[suggestionIndex]);
              return;
            }
            if (suggestions.length && event.key === "Escape") {
              event.preventDefault();
              setSuggestions([]);
              return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void run();
            }
            if (event.key === "Tab") {
              event.preventDefault();
              const target = event.currentTarget;
              const start = target.selectionStart;
              updateSql(active.sql.slice(0, start) + "  " + active.sql.slice(target.selectionEnd));
              window.setTimeout(() => target.setSelectionRange(start + 2, start + 2));
            }
          }} />
          {suggestions.length > 0 && (
            <div className="db-sql-suggestions">
              <div className="db-suggestion-head">Content Assist <kbd>Ctrl+Space</kbd></div>
              {suggestions.map((suggestion, index) => (
                <button key={`${suggestion.kind}-${suggestion.value}`}
                  className={index === suggestionIndex ? "selected" : ""}
                  onMouseDown={(event) => { event.preventDefault(); applySuggestion(suggestion); }}>
                  <span className={`db-suggestion-icon ${suggestion.kind}`}>
                    {suggestion.kind === "table" ? "▦" : suggestion.kind === "column" ? "C" : suggestion.kind === "schema" ? "S" : "K"}
                  </span>
                  <strong>{suggestion.label}</strong><small>{suggestion.detail}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="db-results">
        <div className="db-results-tabs"><button className="active">Results 1</button><button>Output</button></div>
        {error && <div className="db-query-error">
          <strong>{connection === "disconnected" ? "Database is offline" : "Query failed"}</strong>
          <pre>{error}</pre>
          {connection === "disconnected" && <span>The backend tried to start the project-local PostgreSQL service. Check Docker and the configured database port, then execute again.</span>}
        </div>}
        {!error && !result && <div className="db-results-empty">Execute a statement with Ctrl+Enter.</div>}
        {result && (
          <>
            <div className="db-result-grid">
              {result.rows.length === 0 ? <div className="db-results-empty">Query completed. No rows returned.</div> : (
                <table>
                  <thead><tr><th className="db-row-number">#</th>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                  <tbody>{result.rows.map((row, index) => (
                    <tr key={index}><td className="db-row-number">{index + 1}</td>
                      {columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}</tr>
                  ))}</tbody>
                </table>
              )}
            </div>
            <div className="db-result-status">{result.rows.length} row(s) · {result.elapsed.toFixed(0)} ms</div>
          </>
        )}
      </div>
    </div>
  );
}
