import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { flowGraph } from "../model/flow";
import { saveLayout, type NodePosition } from "../model/api";

/**
 * Editable microflow/nanoflow canvas. Nodes are draggable; rearranging them
 * marks the layout dirty and "Save layout" POSTs the new positions to the
 * backend (mocked until the Ruby server exists) as the write-back groundwork.
 */
export default function FlowCanvas({ qn, mdl }: { qn: string; mdl: string }) {
  const graph = useMemo(() => flowGraph(mdl), [mdl]);
  const [nodes, setNodes, onNodesChange] = useNodesState(graph?.nodes ?? []);
  const [edges, setEdges] = useEdgesState(graph?.edges ?? []);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string>();

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
        <span className="hint">Drag blocks to rearrange</span>
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
          onNodesChange={handleChanges}
          fitView
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#2a3547" gap={18} />
          <MiniMap pannable zoomable maskColor="rgba(15,20,32,0.7)" nodeColor="#3a5ea8" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
