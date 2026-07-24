import { Handle, Position, type NodeProps } from "@xyflow/react";

// Studio Pro-like microflow nodes: green start, blue activities with an icon,
// gold decision diamonds, blue end. Styling is driven by theme CSS variables.

const ACT_ICON: Record<string, string> = {
  action: "⚙",
  assign: "✎",
  validation: "✔",
};

type Data = { label: string; kind: string };

export function StartNode() {
  return (
    <div className="sp-terminal sp-start" title="Start">
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

export function EndNode({ data }: NodeProps) {
  return (
    <div className="sp-terminal sp-end" title={(data as Data).label}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
    </div>
  );
}

export function ActivityNode({ data }: NodeProps) {
  const d = data as Data;
  return (
    <div className="sp-activity">
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="sp-act-icon">{ACT_ICON[d.kind] ?? "⚙"}</span>
      <span className="sp-act-label">{d.label}</span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

export function DecisionNode({ data }: NodeProps) {
  const d = data as Data;
  return (
    <div className="sp-decision">
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="sp-caption">{d.label}</span>
      <span className="sp-diamond" />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

export const nodeTypes = {
  start: StartNode,
  end: EndNode,
  activity: ActivityNode,
  decision: DecisionNode,
};
