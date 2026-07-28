import { useMemo } from "react";
import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Assoc } from "../model/er";
import { erGraph } from "../model/er";
import type { ElementDetail, NodePosition } from "../model/types";
import type { Selection } from "./Tree";
import PageBuilder from "./PageBuilder";
import FlowCanvas from "./FlowCanvas";

import type { EditableNode } from "./PageBuilder";

interface Props {
  selection: Selection;
  details: Record<string, ElementDetail>;
  assocs: Assoc[];
  layouts: Record<string, NodePosition[]>;
  onSelect: (qn: string) => void;
  onWidgetSelect?: (node: EditableNode | undefined, changeFn: ((p: string) => void) | undefined) => void;
}

/**
 * The interactive canvas. Chooses a view by element type:
 * - microflow/nanoflow -> editable flowchart (draggable, save layout)
 * - entity             -> domain ER neighbourhood (clickable navigation)
 * - page               -> layout preview
 */
export default function Canvas({ selection, details, assocs, layouts, onSelect, onWidgetSelect }: Props) {
  const { type, qn } = selection;
  const detail = details[qn];

  const er = useMemo(
    () => (type === "entity" ? erGraph(qn, details, assocs) : null),
    [type, qn, details, assocs],
  );

  if (type === "page" && detail) return <PageBuilder selection={selection} detail={detail} onSelect={onSelect} onWidgetSelect={onWidgetSelect} />;
  if ((type === "microflow" || type === "nanoflow") && detail?.mdl)
    return (
      <FlowCanvas
        qn={qn}
        flowType={type}
        mdl={detail.mdl}
        savedPositions={layouts[qn]}
        parameters={detail.parameters as Array<{ name?: string; type?: string }> | undefined}
      />
    );

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
