import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls,
  useNodesState, useEdgesState, useReactFlow, addEdge, reconnectEdge,
  type Connection, type Edge, type Node, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { flowGraph } from "../model/flow";
import { flowBodyMdl } from "../model/flowMdl";
import { saveFlow, saveLayout, type NodePosition } from "../model/api";
import { nodeTypes } from "./nodes";

// Studio Pro-like microflow editor: horizontal flow, a shortcut toolbar on top,
// draggable nodes, and re-wirable arrows. Layout persists in the Ruby inventory;
// structural changes (added blocks / re-wired arrows) are canvas drafts for now —
// the MDL flow round-trip is the next backend step.

interface Props {
  qn: string;
  mdl: string;
  savedPositions?: NodePosition[];
  parameters?: Array<{ name?: string; type?: string }>;
}

function withSavedPositions(nodes: Node[], positions: NodePosition[] = []): Node[] {
  const saved = new Map(positions.map((position) => [position.id, position]));
  return nodes.map((node) => {
    const position = saved.get(node.id);
    return position
      ? { ...node, position: { x: position.x, y: position.y } }
      : node;
  });
}

const SHORTCUTS = [
  { icon: "⚙", label: "Activity", type: "activity", kind: "action" },
  { icon: "◇", label: "Decision", type: "decision", kind: "decision" },
  { icon: "✎", label: "Change", type: "activity", kind: "assign" },
  { icon: "✔", label: "Validation", type: "activity", kind: "validation" },
  { icon: "●", label: "End event", type: "end", kind: "terminal" },
];

// Studio Pro-style edit dialog for a flow block: caption + activity kind, with
// the flow's parameters listed for reference. Edits are canvas drafts.
function NodeEditModal({
  node, parameters, onSave, onClose, onDisconnect,
}: {
  node: Node;
  parameters: Array<{ name?: string; type?: string }>;
  onSave: (label: string, kind: string, stmt: string) => void;
  onClose: () => void;
  onDisconnect?: () => void;
}) {
  const data = node.data as { label?: string; kind?: string; stmt?: string };
  const [label, setLabel] = useState(String(data.label ?? ""));
  const [kind, setKind] = useState(String(data.kind ?? "action"));
  const [stmt, setStmt] = useState(String(data.stmt ?? ""));

  const editableStmt = node.type === "activity" || node.type === "decision";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Edit {node.type}</div>
        <label className="modal-field">
          <span>Caption</span>
          <input value={label} autoFocus onChange={(e) => setLabel(e.target.value)} />
        </label>
        {node.type === "activity" && (
          <label className="modal-field">
            <span>Activity type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="action">Action call</option>
              <option value="assign">Change / assign</option>
              <option value="validation">Validation</option>
            </select>
          </label>
        )}
        {editableStmt && (
          <label className="modal-field">
            <span>MDL statement {node.type === "decision" ? "(if expression)" : ""}</span>
            <textarea
              className="modal-stmt"
              value={stmt}
              spellCheck={false}
              rows={3}
              placeholder={node.type === "decision" ? "$Object/Attribute = true" : "CALL JAVA ACTION Module.Action ()"}
              onChange={(e) => setStmt(e.target.value)}
            />
            <span className="modal-hint">Raw MDL — validated by `mxcli check` on Save flow.</span>
          </label>
        )}
        {parameters.length > 0 && (
          <div className="modal-field">
            <span>Flow parameters</span>
            <ul className="modal-params">
              {parameters.map((parameter, index) => (
                <li key={index}>
                  <code>${parameter.name}</code> : {parameter.type}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="modal-actions">
          {onDisconnect && (
            <button
              className="editor-secondary"
              title="Remove this block's arrows and heal the flow line; the block stays on the canvas"
              onClick={onDisconnect}
            >
              ⛓ Disconnect
            </button>
          )}
          <span className="spacer" />
          <button className="editor-secondary" onClick={onClose}>Cancel</button>
          <button className="w-btn" onClick={() => onSave(label, kind, stmt)}>OK</button>
        </div>
      </div>
    </div>
  );
}

function PersistedFlowInner({ qn, mdl, savedPositions, parameters = [] }: Props) {
  const graph = useMemo(() => flowGraph(mdl), [mdl]);
  const initial = useMemo(
    () => withSavedPositions(graph?.nodes ?? [], savedPositions),
    [graph, savedPositions],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initial);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph?.edges ?? []);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string>();
  const [added, setAdded] = useState(0);
  const [editing, setEditing] = useState<Node>();
  const { zoomIn, zoomOut, zoomTo, fitView, screenToFlowPosition } = useReactFlow();
  const reactFlowRef = useRef<HTMLDivElement>(null);
  const detachedDragRef = useRef<string | null>(null);

  useEffect(() => {
    setNodes(initial);
    setEdges(graph?.edges ?? []);
    setDirty(false);
    setStatus(undefined);
  }, [graph, initial, setNodes, setEdges]);

  const handleChanges = (changes: NodeChange[]) => {
    onNodesChange(changes);
    if (changes.some((change) => change.type === "position")) setDirty(true);
  };

  // Re-wire an existing arrow to a different block.
  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      setEdges((current) => reconnectEdge(oldEdge, connection, current));
      setStatus("Arrow re-wired (canvas draft).");
    },
    [setEdges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) => addEdge({ ...connection, style: { stroke: "var(--edge)" } }, current));
      setStatus("Arrow added (canvas draft).");
    },
    [setEdges],
  );

  // Approximate node center (positions are top-left corners).
  const nodeCenter = (n: Node) => ({
    x: n.position.x + (n.type === "start" || n.type === "end" ? 18 : 70),
    y: n.position.y + (n.type === "start" || n.type === "end" ? 18 : 28),
  });

  // Distance from point p to the segment a–b.
  const segmentDistance = (
    p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number },
  ) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };

  // Edge whose line passes close to the point, if any.
  const edgeNear = useCallback(
    (p: { x: number; y: number }, threshold = 60): Edge | undefined => {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      let best: Edge | undefined;
      let bestDistance = threshold;
      for (const e of edges) {
        const a = byId.get(e.source);
        const b = byId.get(e.target);
        if (!a || !b) continue;
        const d = segmentDistance(p, nodeCenter(a), nodeCenter(b));
        if (d < bestDistance) { bestDistance = d; best = e; }
      }
      return best;
    },
    [nodes, edges],
  );

  // Insert a new node. When `intoEdge` is given, splice it into that arrow
  // (source→new→target). With no edge, the node lands free-floating — connect
  // it by drawing arrows, or drop it onto the flow line to integrate.
  const insertNode = useCallback(
    (type: string, kind: string, label: string, position?: { x: number; y: number }, intoEdge?: Edge | null, stmt?: string) => {
      const id = `new${added}`;
      setAdded((n) => n + 1);

      let pos = position;
      if (!pos) {
        // Place after the rightmost non-end node
        const rightmost = nodes.reduce(
          (max, n) => (n.type !== "end" ? Math.max(max, n.position.x) : max),
          0,
        );
        const endNode = nodes.find((n) => n.type === "end");
        pos = { x: rightmost + 220, y: endNode?.position.y ?? 40 };
      }

      // Default (toolbar button): splice before the end event.
      let target = intoEdge;
      if (target === undefined) {
        const endNode = nodes.find((n) => n.type === "end");
        target = endNode ? edges.find((e) => e.target === endNode.id) ?? null : null;
      }

      const newNode: Node = { id, type, position: pos, data: { label, kind, stmt } };
      setNodes((cur) => [...cur, newNode]);
      if (target) {
        const spliced = target;
        setEdges((cur) => {
          const without = cur.filter((e) => e.id !== spliced.id);
          return [
            ...without,
            { id: `e-${spliced.source}-${id}`, source: spliced.source, target: id, style: { stroke: "var(--edge)" } },
            { id: `e-${id}-${spliced.target}`, source: id, target: spliced.target, style: { stroke: "var(--edge)" } },
          ];
        });
        setStatus(`${label} inserted into the flow (canvas draft).`);
      } else {
        setStatus(`${label} added — drop it on the flow line or draw arrows to connect (canvas draft).`);
      }
      setDirty(true);
    },
    [added, nodes, edges, setNodes, setEdges],
  );

  const addBlock = (shortcut: (typeof SHORTCUTS)[number]) =>
    insertNode(shortcut.type, shortcut.kind, shortcut.label);

  // Detach a node from the flow line, healing predecessor→successor so the
  // flow stays connected; the node itself becomes free-floating.
  const disconnectNode = useCallback(
    (id: string) => {
      const incoming = edges.filter((e) => e.target === id);
      const outgoing = edges.filter((e) => e.source === id);
      setEdges((cur) => {
        let next = cur.filter((e) => e.source !== id && e.target !== id);
        if (incoming.length === 1 && outgoing.length === 1) {
          next = [...next, {
            id: `e-${incoming[0].source}-${outgoing[0].target}`,
            source: incoming[0].source,
            target: outgoing[0].target,
            style: { stroke: "var(--edge)" },
          }];
        }
        return next;
      });
      setDirty(true);
      setStatus("Block disconnected — drag it anywhere, reconnect by drawing arrows (canvas draft).");
    },
    [edges, setEdges],
  );

  // Ctrl+drag detaches a connected block from the flow line: its arrows are
  // removed (predecessor→successor healed) and the block moves freely.
  const onNodeDragStart = useCallback(
    (event: MouseEvent | TouchEvent, node: Node) => {
      if (!("ctrlKey" in event) || !event.ctrlKey) return;
      if (node.type === "start" || node.type === "end") return;
      if (!edges.some((e) => e.source === node.id || e.target === node.id)) return;
      detachedDragRef.current = node.id;
      disconnectNode(node.id);
    },
    [edges, disconnectNode],
  );

  // Dragging a free-floating block onto the flow line splices it into the
  // arrow it lands on (connected blocks just move — arrows follow anyway).
  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      // A Ctrl+drag that just detached this block must not re-link it on drop.
      if (detachedDragRef.current === node.id) {
        detachedDragRef.current = null;
        return;
      }
      if (node.type === "start" || node.type === "end") return;
      const connected = edges.some((e) => e.source === node.id || e.target === node.id);
      if (connected) return;
      const hit = edgeNear(nodeCenter(node));
      if (!hit) return;
      setEdges((cur) => {
        const without = cur.filter((e) => e.id !== hit.id);
        return [
          ...without,
          { id: `e-${hit.source}-${node.id}`, source: hit.source, target: node.id, style: { stroke: "var(--edge)" } },
          { id: `e-${node.id}-${hit.target}`, source: node.id, target: hit.target, style: { stroke: "var(--edge)" } },
        ];
      });
      setDirty(true);
      setStatus("Block linked into the flow (canvas draft).");
    },
    [edges, edgeNear, setEdges],
  );

  // Keyboard deletion (Delete/Backspace via ReactFlow). Start events are
  // protected; deleting a mid-line block heals predecessor→successor so the
  // flow line stays connected. Deleting a selected arrow detaches blocks.
  const onBeforeDelete = useCallback(
    async ({ nodes: doomed, edges: doomedEdges }: { nodes: Node[]; edges: Edge[] }) => {
      const allowed = doomed.filter((n) => n.type !== "start");
      if (!allowed.length && !doomedEdges.length) return false;
      return { nodes: allowed, edges: doomedEdges };
    },
    [],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const gone = new Set(deleted.map((n) => n.id));
      const heals: Edge[] = [];
      deleted.forEach((n) => {
        const incoming = edges.filter((e) => e.target === n.id && !gone.has(e.source));
        const outgoing = edges.filter((e) => e.source === n.id && !gone.has(e.target));
        if (incoming.length === 1 && outgoing.length === 1) {
          heals.push({
            id: `e-${incoming[0].source}-${outgoing[0].target}`,
            source: incoming[0].source,
            target: outgoing[0].target,
            style: { stroke: "var(--edge)" },
          });
        }
      });
      if (heals.length) {
        setEdges((cur) => {
          const ids = new Set(cur.map((e) => e.id));
          return [...cur, ...heals.filter((h) => !ids.has(h.id))];
        });
      }
      setDirty(true);
      setStatus(`${deleted.length === 1 ? "Block" : `${deleted.length} blocks`} deleted (canvas draft).`);
    },
    [edges, setEdges],
  );

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    if (!deleted.length) return;
    setDirty(true);
    setStatus("Arrow removed — block detached from the flow (canvas draft).");
  }, []);

  // Handle drops from the Toolbox (application/flow-node). Dropping on top of
  // the flow line splices into that arrow; dropping elsewhere adds a free node.
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/flow-node");
      if (!raw) return;
      try {
        const { type, kind, label, stmt } = JSON.parse(raw) as { type: string; kind: string; label: string; stmt?: string };
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        insertNode(type, kind, label, pos, edgeNear(pos) ?? null, stmt);
      } catch { /* ignore */ }
    },
    [screenToFlowPosition, insertNode, edgeNear],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/flow-node")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onSave = async () => {
    const positions: NodePosition[] = nodes.map((node) => ({
      id: node.id,
      label: String((node.data as { label?: string }).label ?? ""),
      x: node.position.x,
      y: node.position.y,
    }));
    const { data, mocked } = await saveLayout(qn, positions);
    setStatus((mocked ? "offline — " : "") + data.message);
    if (data.ok) setDirty(false);
  };

  return (
    <div className="canvas-wrap">
      <div className="flow-toolbar">
        <span className="flow-tools">
          {SHORTCUTS.map((shortcut) => (
            <button
              key={shortcut.label}
              className="flow-tool"
              title={`Add ${shortcut.label}`}
              onClick={() => addBlock(shortcut)}
            >
              {shortcut.icon}
            </button>
          ))}
        </span>
        <span className="flow-sep" />
        <button className="flow-tool" title="Zoom in" onClick={() => zoomIn()}>＋</button>
        <button className="flow-tool" title="Zoom out" onClick={() => zoomOut()}>－</button>
        <button className="flow-tool" title="Zoom 100%" onClick={() => zoomTo(1)}>1:1</button>
        <button className="flow-tool" title="Fit view" onClick={() => fitView()}>⛶</button>
        <span className="spacer" />
        {status && <span className="muted">{status}</span>}
        <button className="w-btn" disabled={!dirty} onClick={onSave}>
          Save layout
        </button>
        <button
          className="w-btn"
          title="Serialize the canvas to microflow MDL, validate it, and save a draft"
          onClick={async () => {
            const result = await saveFlow(qn, flowBodyMdl(nodes, edges));
            setStatus(result.message);
          }}
        >
          Save flow
        </button>
      </div>
      <div className="canvas" ref={reactFlowRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleChanges}
          onEdgesChange={onEdgesChange}
          onReconnect={onReconnect}
          onConnect={onConnect}
          onNodeDoubleClick={(_, node) => setEditing(node)}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          multiSelectionKeyCode="Shift"
          onDrop={onDrop}
          onDragOver={onDragOver}
          deleteKeyCode={["Delete", "Backspace"]}
          onBeforeDelete={onBeforeDelete}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          edgesReconnectable
          fitView
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--grid)" gap={18} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {editing && (
        <NodeEditModal
          node={editing}
          parameters={parameters}
          onDisconnect={
            edges.some((e) => e.source === editing.id || e.target === editing.id)
              ? () => { disconnectNode(editing.id); setEditing(undefined); }
              : undefined
          }
          onClose={() => setEditing(undefined)}
          onSave={(label, kind, stmt) => {
            setNodes((current) =>
              current.map((node) =>
                node.id === editing.id
                  ? { ...node, data: { ...node.data, label, kind, stmt: stmt.trim() || undefined } }
                  : node,
              ),
            );
            setDirty(true);
            setEditing(undefined);
            setStatus("Block updated (canvas draft).");
          }}
        />
      )}
    </div>
  );
}

export default function FlowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <PersistedFlowInner {...props} />
    </ReactFlowProvider>
  );
}
