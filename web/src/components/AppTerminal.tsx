import { useCallback, useEffect, useRef, useState } from "react";

export type TerminalMode = "hidden" | "docked" | "floating" | "minimized";

interface LogResponse {
  lines: string[];
  offset: number;
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
  const [offset, setOffset] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef(false);

  // Float position
  const [floatPos, setFloatPos] = useState({ x: 80, y: 80 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Auto-scroll
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines]);

  // Poll log while terminal is visible and running (or just started)
  useEffect(() => {
    if (mode === "hidden" || mode === "minimized") return;
    if (pollingRef.current) return;

    pollingRef.current = true;
    let currentOffset = offset;
    let active = true;

    const poll = async () => {
      let idleTicks = 0;
      while (active) {
        try {
          const data = await fetchLog(currentOffset);
          if (data.lines.length > 0) {
            setLines((prev) => [...prev, ...data.lines]);
            currentOffset = data.offset;
            setOffset(data.offset);
            idleTicks = 0;
          } else {
            idleTicks++;
          }
          onRunningChange(data.running);
          // Stop polling only when truly stopped and no new lines for a while
          if (!data.running && idleTicks > 5) {
            active = false;
          } else {
            await new Promise((r) => setTimeout(r, 400));
          }
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      pollingRef.current = false;
    };

    void poll();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, running]);

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
          onClick={() => { onModeChange("hidden"); setLines([]); setOffset(0); }}
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
