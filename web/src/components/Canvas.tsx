import { useMemo } from "react";
import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Assoc } from "../model/er";
import { erGraph } from "../model/er";
import { flowGraph } from "../model/flow";
import type { ElementDetail } from "../model/types";
import type { Selection } from "./Tree";
import PageView from "./PageView";

interface Props {
  selection: Selection;
  details: Record<string, ElementDetail>;
  assocs: Assoc[];
  onSelect: (qn: string) => void;
}

/**
 * The interactive canvas. Nodes are draggable (React Flow default), which is the
 * foundation for the block-editing / drag-and-drop workflow. For entities,
 * clicking a neighbour navigates to it.
 */
export default function Canvas({ selection, details, assocs, onSelect }: Props) {
  const { type, qn } = selection;
  const detail = details[qn];

  const graph = useMemo(() => {
    if ((type === "microflow" || type === "nanoflow") && detail?.mdl) return flowGraph(detail.mdl);
    if (type === "entity") return erGraph(qn, details, assocs);
    return null;
  }, [type, qn, detail, details, assocs]);

  if (type === "page" && detail) return <PageView selection={selection} detail={detail} onSelect={onSelect} />;
  if (!graph) return null;

  return (
    <div className="canvas">
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        fitView
        minZoom={0.15}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => {
          if (type === "entity" && node.id !== qn) onSelect(node.id);
        }}
      >
        <Background color="#2a3547" gap={18} />
        <MiniMap pannable zoomable maskColor="rgba(15,20,32,0.7)" nodeColor="#3a5ea8" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
