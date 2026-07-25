import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, useReactFlow, addEdge, reconnectEdge,
  type Connection, type Edge, type Node, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { flowGraph } from "../model/flow";
import { saveLayout, type NodePosition } from "../model/api";
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
  node, parameters, onSave, onClose,
}: {
  node: Node;
  parameters: Array<{ name?: string; type?: string }>;
  onSave: (label: string, kind: string) => void;
  onClose: () => void;
}) {
  const data = node.data as { label?: string; kind?: string };
  const [label, setLabel] = useState(String(data.label ?? ""));
  const [kind, setKind] = useState(String(data.kind ?? "action"));

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
          <button className="editor-secondary" onClick={onClose}>Cancel</button>
          <button className="w-btn" onClick={() => onSave(label, kind)}>OK</button>
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
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();

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

  const addBlock = (shortcut: (typeof SHORTCUTS)[number]) => {
    const rightmost = nodes.reduce((max, node) => Math.max(max, node.position.x), 0);
    const id = `new${added}`;
    setAdded((n) => n + 1);
    setNodes((current) => [
      ...current,
      {
        id,
        type: shortcut.type,
        position: { x: rightmost + 230, y: 40 },
        data: { label: shortcut.label, kind: shortcut.kind },
      },
    ]);
    setDirty(true);
    setStatus(`${shortcut.label} added (canvas draft).`);
  };

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
      </div>
      <div className="canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleChanges}
          onEdgesChange={onEdgesChange}
          onReconnect={onReconnect}
          onConnect={onConnect}
          onNodeDoubleClick={(_, node) => setEditing(node)}
          edgesReconnectable
          fitView
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--grid)" gap={18} />
          <MiniMap pannable zoomable maskColor="rgba(0,0,0,0.5)" nodeColor="var(--accent)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {editing && (
        <NodeEditModal
          node={editing}
          parameters={parameters}
          onClose={() => setEditing(undefined)}
          onSave={(label, kind) => {
            setNodes((current) =>
              current.map((node) =>
                node.id === editing.id ? { ...node, data: { ...node.data, label, kind } } : node,
              ),
            );
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
