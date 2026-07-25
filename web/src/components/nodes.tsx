import { Handle, Position, type NodeProps } from "@xyflow/react";

// Studio Pro-like microflow nodes laid out left-to-right: green start, rounded
// activity cards, gold decision diamonds, red end. Handles sit on the sides so
// flows read horizontally, and stay connectable so arrows can be re-wired.

const ACT_ICON: Record<string, string> = {
  action: "⚙",
  assign: "✎",
  validation: "✔",
};

type Data = { label: string; kind: string };

export function StartNode() {
  return (
    <div className="sp-terminal sp-start" title="Start">
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function EndNode({ data }: NodeProps) {
  return (
    <div className="sp-terminal sp-end" title={(data as Data).label}>
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

export function ActivityNode({ data }: NodeProps) {
  const d = data as Data;
  return (
    <div className="sp-activity">
      <Handle type="target" position={Position.Left} />
      <span className="sp-act-icon">{ACT_ICON[d.kind] ?? "⚙"}</span>
      <span className="sp-act-label">{d.label}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function DecisionNode({ data }: NodeProps) {
  const d = data as Data;
  return (
    <div className="sp-decision">
      <Handle type="target" position={Position.Left} />
      <span className="sp-caption">{d.label}</span>
      <span className="sp-diamond" />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const nodeTypes = {
  start: StartNode,
  end: EndNode,
  activity: ActivityNode,
  decision: DecisionNode,
};
