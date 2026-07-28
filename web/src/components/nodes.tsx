import { Handle, Position, type NodeProps } from "@xyflow/react";
import { activitySpec } from "../model/flowActivities";

// Studio Pro-like node renderers. Layout: horizontal, left→right.
// Each node type mirrors the shape, color, and label conventions used in
// Studio Pro's microflow canvas.

const KIND_META: Record<string, { icon: string; category: string }> = {
  action:     { icon: "⚙",  category: "Action call" },
  assign:     { icon: "✎",  category: "Change / Variable" },
  createVariable: { icon: "＋", category: "Create variable" },
  validation: { icon: "✔",  category: "Validation" },
  retrieve:   { icon: "⤵",  category: "Retrieve" },
  commit:     { icon: "↓",  category: "Commit" },
  create:     { icon: "＋", category: "Create" },
  changeObject: { icon: "✎", category: "Change object" },
  delete:     { icon: "🗑", category: "Delete" },
  rollback:   { icon: "↺",  category: "Rollback" },
  java:       { icon: "☕", category: "Java action" },
  microflow:  { icon: "⚙", category: "Microflow call" },
  javascript: { icon: "𝒋",  category: "JS action" },
  showPage:   { icon: "▤", category: "Show page" },
  showMessage:{ icon: "⚑", category: "Show message" },
  rest:       { icon: "⇄", category: "Call REST service" },
  webservice: { icon: "☁", category: "Call web service" },
  log:        { icon: "▤", category: "Log message" },
};

type Data = { label?: string; kind?: string };

// ── Start event ── green filled circle ─────────────────────────────────────
export function StartNode() {
  return (
    <div className="sp-terminal sp-start" title="Start">
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

// ── End event ── solid filled circle (red / theme color) ───────────────────
export function EndNode({ data }: NodeProps) {
  return (
    <div className="sp-terminal sp-end" title={String((data as Data).label ?? "End")}>
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

// ── Activity ── rounded rect, icon + caption + category label ──────────────
export function ActivityNode({ data }: NodeProps) {
  const d = data as Data;
  const kind = (d.kind ?? "action").toLowerCase();
  const catalog = activitySpec(d.kind);
  const meta = catalog ? { icon: catalog.icon, category: catalog.label } : (KIND_META[kind] ?? KIND_META.action);
  return (
    <div className="sp-activity">
      <Handle type="target" position={Position.Left} />
      <div className="sp-act-icon">{meta.icon}</div>
      <div className="sp-act-body">
        <div className="sp-act-label">{d.label ?? "Activity"}</div>
        <div className="sp-act-category">{meta.category}</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

// ── Exclusive Split / Decision ── diamond, caption below ───────────────────
// One target (left), two sources: right = true, bottom = false.
export function DecisionNode({ data }: NodeProps) {
  const d = data as Data;
  return (
    <div className="sp-decision-wrap">
      <Handle type="target" position={Position.Left} id="in" />
      <div className="sp-diamond" />
      {d.label && <div className="sp-caption">{d.label}</div>}
      <Handle type="source" position={Position.Right} id="true" />
      <Handle type="source" position={Position.Bottom} id="false" />
    </div>
  );
}

// ── Merge ── neutral diamond, multiple incomings → one outgoing ────────────
export function MergeNode({ data }: NodeProps) {
  const d = data as Data;
  return (
    <div className="sp-merge-wrap">
      <Handle type="target" position={Position.Left}   id="in1" />
      <Handle type="target" position={Position.Top}    id="in2" />
      <Handle type="target" position={Position.Bottom} id="in3" />
      <div className="sp-merge-diamond" />
      {d.label && <div className="sp-caption sp-merge-caption">{d.label}</div>}
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}

// ── Loop ── rectangular frame with dashed border ───────────────────────────
export function LoopNode({ data }: NodeProps) {
  const d = data as { label?: string; iterator?: string; iterType?: string };
  const iter = d.iterator ?? d.label;
  return (
    <div className="sp-loop">
      <Handle type="target" position={Position.Left}  id="in" />
      <div className="sp-loop-header">
        <span className="sp-loop-kw">↻ Loop</span>
        {iter     && <span className="sp-loop-iter">{iter}</span>}
        {d.iterType && <span className="sp-loop-type">{d.iterType}</span>}
      </div>
      <div className="sp-loop-body" />
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}

// ── Parameter ── input parameter shown before the Start event ─────────────
export function ParameterNode({ data }: NodeProps) {
  const d = data as { label?: string; paramType?: string };
  return (
    <div className="sp-parameter">
      <div className="sp-param-name">{d.label ?? "$param"}</div>
      <div className="sp-param-type">{d.paramType ?? "Object"}</div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}

export const nodeTypes = {
  start:     StartNode,
  end:       EndNode,
  activity:  ActivityNode,
  decision:  DecisionNode,
  merge:     MergeNode,
  loop:      LoopNode,
  parameter: ParameterNode,
};
