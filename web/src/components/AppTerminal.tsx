import { useCallback, useEffect, useRef, useState } from "react";

export type TerminalMode = "hidden" | "docked" | "floating" | "minimized";

interface LogResponse {
  lines: string[];
  offset: number;
  total?: number;
  running: boolean;
}

async function fetchLog(offset: number): Promise<LogResponse> {
  const r = await fetch(`/api/app/log?offset=${offset}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<LogResponse>;
}

async function stopApp(): Promise<void> {
  await fetch("/api/app/stop", { method: "POST" });
}

export interface AppTerminalHandle {
  reset: () => void;
}

interface Props {
  mode: TerminalMode;
  onModeChange: (m: TerminalMode) => void;
  running: boolean;
  onRunningChange: (running: boolean) => void;
}

export default function AppTerminal({ mode, onModeChange, running, onRunningChange }: Props) {
  const [lines, setLines] = useState<string[]>([]);
  const offsetRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Float position
  const [floatPos, setFloatPos] = useState({ x: 80, y: 80 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Auto-scroll
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines]);

  // Poll the log for as long as the terminal is visible. Keyed on `mode` only:
  // restarting the loop on every `running` flip is what used to race the old
  // loop's wind-down and leave the console frozen with no active poller.
  // While the app runs we poll fast; when it's idle we keep a slow heartbeat
  // so a later Run/Re-Run picks up immediately.
  useEffect(() => {
    if (mode === "hidden" || mode === "minimized") return;
    let active = true;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const poll = async () => {
      while (active) {
        try {
          const data = await fetchLog(offsetRef.current);
          if (!active) break;
          // Backend log shrank (restarted backend or reset log): resync
          // from the top instead of polling past its end forever.
          if (data.total !== undefined && data.total < offsetRef.current) {
            offsetRef.current = 0;
            setLines([]);
            continue;
          }
          if (data.lines.length > 0) {
            setLines((prev) => [...prev, ...data.lines]);
            offsetRef.current = data.offset;
          }
          onRunningChange(data.running);
          await sleep(data.running || data.lines.length > 0 ? 400 : 1500);
        } catch {
          await sleep(2000);
        }
      }
    };

    void poll();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Drag handlers for floating mode
  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (mode !== "floating") return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: floatPos.x, origY: floatPos.y };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setFloatPos({
        x: dragRef.current.origX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (ev.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [mode, floatPos]);

  if (mode === "hidden") return null;
  if (mode === "minimized") return null; // handled as status bar badge

  const isFloat = mode === "floating";

  const header = (
    <div className="term-header" onMouseDown={onDragStart}>
      <span className={`term-status ${running ? "running" : "stopped"}`}>
        {running ? "▶" : "■"}
      </span>
      <span className="term-title">Application Console</span>
      <div className="term-actions">
        <button
          className="term-btn"
          title={isFloat ? "Dock to bottom" : "Float as window"}
          onClick={() => onModeChange(isFloat ? "docked" : "floating")}
        >
          {isFloat ? "⊟" : "⊞"}
        </button>
        <button className="term-btn" title="Minimize" onClick={() => onModeChange("minimized")}>
          _
        </button>
        {running && (
          <button
            className="term-btn term-btn-stop"
            title="Stop application"
            onClick={() => void stopApp()}
          >
            ■
          </button>
        )}
        <button
          className="term-btn term-btn-close"
          title="Close terminal"
          onClick={() => { onModeChange("hidden"); setLines([]); offsetRef.current = 0; }}
        >
          ✕
        </button>
      </div>
    </div>
  );

  const body = (
    <div className="term-body" ref={bodyRef}>
      {lines.map((l, i) => (
        <div key={i} className={`term-line ${l.startsWith("[ERROR]") ? "term-err" : l.startsWith("$") ? "term-cmd" : ""}`}>
          {l}
        </div>
      ))}
      {lines.length === 0 && <span className="term-empty">No output yet…</span>}
    </div>
  );

  if (isFloat) {
    return (
      <div
        className="term-float"
        style={{ left: floatPos.x, top: floatPos.y }}
      >
        {header}
        {body}
      </div>
    );
  }

  return (
    <div className="term-docked">
      {header}
      {body}
    </div>
  );
}
