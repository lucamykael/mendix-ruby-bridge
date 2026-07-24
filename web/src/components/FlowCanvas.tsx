import { useEffect, useMemo, useState, type DragEvent } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, useReactFlow,
  useNodesState, useEdgesState, type Node, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { flowGraph } from "../model/flow";
import { saveLayout, type NodePosition } from "../model/api";
import { nodeTypes } from "./nodes";

/**
 * Editable microflow/nanoflow canvas. Existing nodes are draggable; dropping a
 * Toolbox activity adds a new node at the cursor. Both mark the layout dirty and
 * "Save layout" POSTs the positions to the backend (mocked until it exists).
 */
function FlowInner({ qn, mdl }: { qn: string; mdl: string }) {
  const graph = useMemo(() => flowGraph(mdl), [mdl]);
  const [nodes, setNodes, onNodesChange] = useNodesState(graph?.nodes ?? []);
  const [edges, setEdges] = useEdgesState(graph?.edges ?? []);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string>();
  const { screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    if (graph) {
      setNodes(graph.nodes);
      setEdges(graph.edges);
      setDirty(false);
      setStatus(undefined);
    }
  }, [graph, setNodes, setEdges]);

  const handleChanges = (changes: NodeChange[]) => {
    onNodesChange(changes);
    if (changes.some((c) => c.type === "position")) setDirty(true);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/mrb-item");
    if (!raw) return;
    const item = JSON.parse(raw) as { label: string };
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const node: Node = {
      id: `new-${Date.now()}`,
      type: "activity",
      position,
      data: { label: item.label, kind: "action" },
    };
    setNodes((nds) => [...nds, node]);
    setDirty(true);
  };

  const onSave = async () => {
    const positions: NodePosition[] = nodes.map((n) => ({
      id: n.id,
      label: String((n.data as { label?: string }).label ?? ""),
      x: n.position.x,
      y: n.position.y,
    }));
    const { data, mocked } = await saveLayout(qn, positions);
    setStatus((mocked ? "offline — " : "") + (data.ok ? "layout saved" : "save failed"));
    setDirty(false);
  };

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar">
        <span className="hint">Drag blocks to rearrange · drop from the Toolbox to add</span>
        <span className="spacer" />
        {status && <span className="muted">{status}</span>}
        <button className="w-btn" disabled={!dirty} onClick={onSave}>
          Save layout
        </button>
      </div>
      <div className="canvas" onDrop={onDrop} onDragOver={onDragOver}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleChanges}
          fitView
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--grid)" gap={18} />
          <MiniMap pannable zoomable maskColor="rgba(0,0,0,0.5)" nodeColor="var(--accent)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function FlowCanvas(props: { qn: string; mdl: string }) {
  return (
    <ReactFlowProvider>
      <FlowInner {...props} />
    </ReactFlowProvider>
  );
}
