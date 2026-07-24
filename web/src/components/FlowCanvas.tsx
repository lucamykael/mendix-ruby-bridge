import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, type Node, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { flowGraph } from "../model/flow";
import { saveLayout, type NodePosition } from "../model/api";
import { nodeTypes } from "./nodes";

interface Props {
  qn: string;
  mdl: string;
  savedPositions?: NodePosition[];
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

function PersistedFlowInner({ qn, mdl, savedPositions }: Props) {
  const graph = useMemo(() => flowGraph(mdl), [mdl]);
  const initial = useMemo(
    () => withSavedPositions(graph?.nodes ?? [], savedPositions),
    [graph, savedPositions],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initial);
  const [edges, setEdges] = useEdgesState(graph?.edges ?? []);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string>();

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
      <div className="canvas-toolbar">
        <span className="hint">Drag blocks to rearrange · positions persist in the Ruby inventory</span>
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

export default function FlowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <PersistedFlowInner {...props} />
    </ReactFlowProvider>
  );
}
