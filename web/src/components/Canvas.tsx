import { useMemo } from "react";
import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Assoc } from "../model/er";
import { erGraph } from "../model/er";
import type { ElementDetail } from "../model/types";
import type { Selection } from "./Tree";
import PageView from "./PageView";
import FlowCanvas from "./FlowCanvas";

interface Props {
  selection: Selection;
  details: Record<string, ElementDetail>;
  assocs: Assoc[];
  onSelect: (qn: string) => void;
}

/**
 * The interactive canvas. Chooses a view by element type:
 * - microflow/nanoflow -> editable flowchart (draggable, save layout)
 * - entity             -> domain ER neighbourhood (clickable navigation)
 * - page               -> layout preview
 */
export default function Canvas({ selection, details, assocs, onSelect }: Props) {
  const { type, qn } = selection;
  const detail = details[qn];

  const er = useMemo(
    () => (type === "entity" ? erGraph(qn, details, assocs) : null),
    [type, qn, details, assocs],
  );

  if (type === "page" && detail) return <PageView selection={selection} detail={detail} onSelect={onSelect} />;
  if ((type === "microflow" || type === "nanoflow") && detail?.mdl) return <FlowCanvas qn={qn} mdl={detail.mdl} />;

  if (er) {
    return (
      <div className="canvas">
        <ReactFlow
          nodes={er.nodes}
          edges={er.edges}
          fitView
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => {
            if (node.id !== qn) onSelect(node.id);
          }}
        >
          <Background color="var(--grid)" gap={18} />
          <MiniMap pannable zoomable maskColor="rgba(0,0,0,0.5)" nodeColor="var(--accent)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    );
  }
  return null;
}
