import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls,
  useNodesState, useEdgesState, useReactFlow, addEdge, reconnectEdge,
  ConnectionLineType,
  MarkerType,
  type Connection, type Edge, type Node, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { flowGraph } from "../model/flow";
import { flowBodyMdl } from "../model/flowMdl";
import { applyDraft, saveFlow, saveLayout, type NodePosition } from "../model/api";
import { activitiesFor, activitySpec } from "../model/flowActivities";
import { nodeTypes } from "./nodes";

// Studio Pro-like microflow editor: horizontal flow, a shortcut toolbar on top,
// draggable nodes, and re-wirable arrows. Layout persists in the Ruby inventory;
// structural changes (added blocks / re-wired arrows) are pending canvas changes —
// the MDL flow round-trip is the next backend step.

interface Props {
  qn: string;
  flowType?: "microflow" | "nanoflow";
  mdl: string;
  savedPositions?: NodePosition[];
  parameters?: Array<{ name?: string; type?: string }>;
}

function withSavedPositions(nodes: Node[], positions: NodePosition[] = []): Node[] {
  const saved = new Map(positions.map((position) => [position.id, position]));
  const byLabel = new Map(positions.map((position) => [position.label, position]));
  return nodes.map((node) => {
    const label = String((node.data as { label?: string }).label ?? "");
    const sameId = saved.get(node.id);
    const position = sameId?.label === label ? sameId : byLabel.get(label);
    return position
      ? { ...node, position: { x: position.x, y: position.y } }
      : node;
  });
}

const FLOW_X_GAP = 250;
const FLOW_Y_GAP = 130;

function nodeSize(node: Node) {
  if (node.type === "start" || node.type === "end") return { width: 34, height: 34 };
  if (node.type === "decision") return { width: 110, height: 82 };
  if (node.type === "merge") return { width: 80, height: 66 };
  if (node.type === "loop") return { width: 260, height: 150 };
  if (node.type === "parameter") return { width: 150, height: 48 };
  return { width: 180, height: 58 };
}

function positionsCollide(nodes: Node[]): boolean {
  for (let index = 0; index < nodes.length; index += 1) {
    const a = nodes[index];
    if (a.type === "parameter") continue;
    const as = nodeSize(a);
    for (let other = index + 1; other < nodes.length; other += 1) {
      const b = nodes[other];
      if (b.type === "parameter") continue;
      const bs = nodeSize(b);
      if (
        a.position.x < b.position.x + bs.width + 24 &&
        a.position.x + as.width + 24 > b.position.x &&
        a.position.y < b.position.y + bs.height + 24 &&
        a.position.y + as.height + 24 > b.position.y
      ) return true;
    }
  }
  return false;
}

// Layered left-to-right layout matching Studio Pro's normal-flow convention.
// Cycles are bounded, branches occupy separate rows, and merges return to the
// center row. Existing Y positions are used only to keep branch order stable.
function arrangeFlow(nodes: Node[], edges: Edge[]): Node[] {
  const flowNodes = nodes.filter((node) => node.type !== "parameter");
  const parameters = nodes.filter((node) => node.type === "parameter");
  const rank = new Map<string, number>();
  const incoming = new Map<string, number>();
  flowNodes.forEach((node) => incoming.set(node.id, 0));
  edges.forEach((edge) => incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1));
  const start = flowNodes.find((node) => node.type === "start") ??
    flowNodes.find((node) => (incoming.get(node.id) ?? 0) === 0) ?? flowNodes[0];
  if (start) rank.set(start.id, 0);

  // Longest-path layering for DAG portions; bounded passes also handle loops.
  for (let pass = 0; pass < flowNodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const sourceRank = rank.get(edge.source);
      if (sourceRank === undefined) continue;
      const next = Math.min(sourceRank + 1, flowNodes.length);
      if (rank.get(edge.target) === undefined || next > (rank.get(edge.target) ?? 0)) {
        rank.set(edge.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  let fallbackRank = Math.max(0, ...rank.values()) + 1;
  flowNodes.forEach((node) => {
    if (!rank.has(node.id)) rank.set(node.id, fallbackRank++);
  });

  const layers = new Map<number, Node[]>();
  flowNodes.forEach((node) => {
    const layer = layers.get(rank.get(node.id) ?? 0) ?? [];
    layer.push(node);
    layers.set(rank.get(node.id) ?? 0, layer);
  });

  const placed = new Map<string, { x: number; y: number }>();
  [...layers.entries()].sort(([a], [b]) => a - b).forEach(([level, layer]) => {
    layer.sort((a, b) => a.position.y - b.position.y || a.id.localeCompare(b.id));
    const total = (layer.length - 1) * FLOW_Y_GAP;
    layer.forEach((node, index) => {
      placed.set(node.id, { x: level * FLOW_X_GAP, y: index * FLOW_Y_GAP - total / 2 });
    });
  });

  // False decision paths conventionally run below the normal route.
  edges.forEach((edge) => {
    if (String(edge.label ?? "").toLowerCase() !== "false") return;
    const current = placed.get(edge.target);
    if (current) placed.set(edge.target, { ...current, y: Math.max(current.y, FLOW_Y_GAP) });
  });

  const startPosition = start ? placed.get(start.id) ?? { x: 0, y: 0 } : { x: 0, y: 0 };
  const arrangedParams = parameters.map((node, index) => ({
    ...node,
    position: {
      x: startPosition.x - 190,
      y: startPosition.y - ((parameters.length - 1) * 58) / 2 + index * 58,
    },
  }));
  return [
    ...flowNodes.map((node) => ({ ...node, position: placed.get(node.id) ?? node.position })),
    ...arrangedParams,
  ];
}

const SHORTCUTS = [
  { icon: "⚙", label: "Activity",    type: "activity", kind: "action" },
  { icon: "◇", label: "Decision",    type: "decision", kind: "decision" },
  { icon: "◈", label: "Merge",       type: "merge", kind: "merge" },
  { icon: "↻", label: "Loop",        type: "loop", kind: "loop" },
  { icon: "!", label: "Error event", type: "end", kind: "error" },
  { icon: "●", label: "End event",   type: "end", kind: "terminal" },
];

function statementFields(stmt: string) {
  const declaration = stmt.match(/^DECLARE\s+\$?(\w+)\s+(\S+)\s*=\s*(.*?);?$/i);
  const assignment = stmt.match(/^SET\s+\$?(\w+)\s*=\s*(.*?);?$/i);
  return declaration
    ? { variable: declaration[1], valueType: declaration[2], value: declaration[3] }
    : assignment
      ? { variable: assignment[1], valueType: "String", value: assignment[2] }
      : { variable: "", valueType: "String", value: "" };
}

function activityStatement(kind: string, variable: string, valueType: string, value: string, raw: string) {
  const name = variable.trim().replace(/^\$/, "") || "NewValue";
  const expression = value.trim() || "empty";
  if (kind === "createVariable") return `DECLARE $${name} ${valueType || "String"} = ${expression};`;
  if (kind === "assign") return `SET $${name} = ${expression};`;
  return raw.trim();
}

type ActivityConfig = {
  result: string; target: string; object: string; entity: string; value: string;
  members: string; condition: string; sort: string; limit: string; operation: string;
  arguments: string; message: string; level: string; nodeName: string; attribute: string;
  events: boolean; refresh: boolean;
};

const DEFAULT_ACTIVITY_CONFIG: ActivityConfig = {
  result: "Result", target: "", object: "", entity: "", value: "", members: "",
  condition: "", sort: "", limit: "", operation: "HEAD", arguments: "",
  message: "", level: "INFO", nodeName: "", attribute: "", events: false, refresh: false,
};

const dollar = (value: string) => value.trim().startsWith("$") ? value.trim() : `$${value.trim()}`;

function configuredStatement(kind: string, config: ActivityConfig, fallback: string): string {
  const result = dollar(config.result || "Result");
  const object = dollar(config.object || "Object");
  const target = config.target.trim() || "Module.Action";
  const args = config.arguments.trim();
  switch (kind) {
    case "create":
      return `${result} = CREATE ${config.entity || "Module.Entity"} (${config.members.trim()});`;
    case "changeObject":
      return `CHANGE ${object} (${config.members.trim()});`;
    case "commit":
      return `COMMIT ${object}${config.events ? " WITH EVENTS" : ""}${config.refresh ? " REFRESH" : ""};`;
    case "delete": return `DELETE ${object};`;
    case "rollback": return `ROLLBACK ${object};`;
    case "retrieve":
      return `RETRIEVE ${result} FROM ${config.entity || "Module.Entity"}${config.condition.trim() ? `\n  WHERE ${config.condition.trim()}` : ""}${config.sort.trim() ? `\n  SORT BY ${config.sort.trim()}` : ""}${config.limit.trim() ? `\n  LIMIT ${config.limit.trim()}` : ""};`;
    case "createList": return `${result} = CREATE LIST OF ${config.entity || "Module.Entity"};`;
    case "changeList":
      return `${config.operation === "REMOVE" ? "REMOVE" : "ADD"} ${dollar(config.value || "Item")} ${config.operation === "REMOVE" ? "FROM" : "TO"} ${object};`;
    case "listOperation":
    case "aggregate":
      return `${result} = ${config.operation || "HEAD"}(${object}${config.value.trim() ? `, ${config.value.trim()}` : ""});`;
    case "java": return `${result} = CALL JAVA ACTION ${target} (${args});`;
    case "javascript": return `${result} = CALL JAVASCRIPT ACTION ${target} (${args});`;
    case "microflow": return `${result} = CALL MICROFLOW ${target} (${args});`;
    case "nanoflow": return `${result} = CALL NANOFLOW ${target} (${args});`;
    case "showPage": return `SHOW PAGE ${target}${args ? ` (${args})` : ""};`;
    case "closePage": return "CLOSE PAGE;";
    case "validation":
      return `VALIDATION FEEDBACK ${object}/${config.attribute || "Attribute"} MESSAGE '${config.message.replace(/'/g, "''")}';`;
    case "log":
      return `LOG ${config.level}${config.nodeName.trim() ? ` NODE '${config.nodeName.replace(/'/g, "''")}'` : ""} '${config.message.replace(/'/g, "''")}';`;
    default: return fallback.trim();
  }
}

// Studio Pro uses a modal dialog for the action configuration, while caption,
// error handling and other common settings remain separate properties.
function NodeEditModal({
  node, flowType, parameters, onSave, onClose, onDisconnect,
}: {
  node: Node;
  flowType: "microflow" | "nanoflow";
  parameters: Array<{ name?: string; type?: string }>;
  onSave: (label: string, kind: string, stmt: string) => void;
  onClose: () => void;
  onDisconnect?: () => void;
}) {
  const data = node.data as { label?: string; kind?: string; stmt?: string };
  const [label, setLabel] = useState(String(data.label ?? ""));
  const [kind, setKind] = useState(String(data.kind ?? "action"));
  const [stmt, setStmt] = useState(String(data.stmt ?? ""));
  const initialFields = statementFields(String(data.stmt ?? ""));
  const [variable, setVariable] = useState(initialFields.variable);
  const [valueType, setValueType] = useState(initialFields.valueType);
  const [value, setValue] = useState(initialFields.value);
  const [errorHandling, setErrorHandling] = useState("Rollback");
  const [tab, setTab] = useState<"action" | "common" | "advanced">("action");
  const [config, setConfig] = useState<ActivityConfig>(DEFAULT_ACTIVITY_CONFIG);
  const [configDirty, setConfigDirty] = useState(false);

  const editableStmt = node.type === "activity" || node.type === "decision";
  const variableActivity = node.type === "activity" && ["createVariable", "assign"].includes(kind);
  const selectedActivity = activitySpec(kind);
  const save = () => onSave(
    label,
    kind,
    variableActivity
      ? activityStatement(kind, variable, valueType, value, stmt)
      : configDirty || !stmt.trim() ? configuredStatement(kind, config, stmt) : stmt,
  );
  const configure = <K extends keyof ActivityConfig>(key: K, next: ActivityConfig[K]) => {
    setConfigDirty(true);
    setConfig((current) => ({ ...current, [key]: next }));
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal flow-properties-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title flow-modal-title">
          <span className="flow-modal-icon">{node.type === "decision" ? "◇" : node.type === "loop" ? "↻" : "⚙"}</span>
          {node.type === "activity" ? selectedActivity?.label ?? "Activity" : `Edit ${node.type}`}
          <button aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="flow-modal-tabs">
          <button className={tab === "action" ? "on" : ""} onClick={() => setTab("action")}>Action</button>
          <button className={tab === "common" ? "on" : ""} onClick={() => setTab("common")}>Common</button>
          {editableStmt && <button className={tab === "advanced" ? "on" : ""} onClick={() => setTab("advanced")}>Advanced</button>}
        </div>
        <div className="flow-modal-body">
          {tab === "action" && (
            <>
              {node.type === "activity" && (
                <label className="modal-field">
                  <span>Action</span>
                  <select value={kind} autoFocus onChange={(e) => { setKind(e.target.value); setConfigDirty(true); }}>
                    {!activitySpec(kind) && <option value={kind}>Generic activity</option>}
                    {activitiesFor(flowType).map((activity) =>
                      <option key={activity.id} value={activity.id}>{activity.label}</option>)}
                  </select>
                </label>
              )}
              {selectedActivity && !selectedActivity.writable && (
                <div className="flow-sdk-warning">
                  <strong>Model SDK writer required</strong>
                  <span>The activity is available for modeling, but this mxcli version cannot write it to the .mpr yet.</span>
                </div>
              )}
              {node.type === "decision" && (
                <label className="modal-field">
                  <span>Expression</span>
                  <textarea className="modal-stmt" value={stmt} rows={4}
                    placeholder="$Order/Status = MyModule.Status.Paid"
                    onChange={(e) => setStmt(e.target.value)} />
                </label>
              )}
              {variableActivity && (
                <>
                  <label className="modal-field"><span>Variable</span>
                    {kind === "createVariable"
                      ? <input value={variable} placeholder="NewVariable" onChange={(e) => setVariable(e.target.value)} />
                      : <select value={variable} onChange={(e) => setVariable(e.target.value)}>
                          <option value="">Select variable…</option>
                          {parameters.map((parameter, index) => (
                            <option key={index} value={parameter.name}>{parameter.name} ({parameter.type})</option>
                          ))}
                          {variable && !parameters.some((parameter) => parameter.name === variable) &&
                            <option value={variable}>{variable}</option>}
                        </select>}
                  </label>
                  {kind === "createVariable" && (
                    <label className="modal-field"><span>Data type</span>
                      <select value={valueType} onChange={(e) => setValueType(e.target.value)}>
                        {["String", "Boolean", "Integer", "Long", "Decimal", "DateTime"].map((type) =>
                          <option key={type}>{type}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="modal-field"><span>Value</span>
                    <textarea className="modal-stmt" value={value} rows={3}
                      placeholder={kind === "createVariable" ? "'value'" : "$ExistingValue"}
                      onChange={(e) => setValue(e.target.value)} />
                  </label>
                </>
              )}
              {["create", "changeObject"].includes(kind) && (
                <>
                  {kind === "create" && <label className="modal-field"><span>Entity</span>
                    <input value={config.entity} placeholder="Module.Entity" onChange={(e) => configure("entity", e.target.value)} />
                  </label>}
                  {kind === "changeObject" && <label className="modal-field"><span>Object</span>
                    <input value={config.object} placeholder="$Object" onChange={(e) => configure("object", e.target.value)} />
                  </label>}
                  <label className="modal-field"><span>Change members</span>
                    <textarea className="modal-stmt" rows={4} value={config.members}
                      placeholder={"Attribute = expression,\nAssociation = $Object"}
                      onChange={(e) => configure("members", e.target.value)} />
                  </label>
                  {kind === "create" && <label className="modal-field"><span>Object name</span>
                    <input value={config.result} onChange={(e) => configure("result", e.target.value)} />
                  </label>}
                </>
              )}
              {["commit", "delete", "rollback"].includes(kind) && (
                <>
                  <label className="modal-field"><span>Object or list</span>
                    <input value={config.object} placeholder="$Object" onChange={(e) => configure("object", e.target.value)} />
                  </label>
                  {kind === "commit" && <div className="flow-check-grid">
                    <label><input type="checkbox" checked={config.events}
                      onChange={(e) => configure("events", e.target.checked)} /> With events</label>
                    <label><input type="checkbox" checked={config.refresh}
                      onChange={(e) => configure("refresh", e.target.checked)} /> Refresh in client</label>
                  </div>}
                </>
              )}
              {kind === "retrieve" && (
                <>
                  <label className="modal-field"><span>Source entity</span>
                    <input value={config.entity} placeholder="Module.Entity" onChange={(e) => configure("entity", e.target.value)} />
                  </label>
                  <label className="modal-field"><span>XPath / condition</span>
                    <textarea className="modal-stmt" rows={3} value={config.condition}
                      placeholder="Status = MyModule.Status.Active" onChange={(e) => configure("condition", e.target.value)} />
                  </label>
                  <label className="modal-field"><span>Sort</span>
                    <input value={config.sort} placeholder="CreatedDate DESC" onChange={(e) => configure("sort", e.target.value)} />
                  </label>
                  <label className="modal-field"><span>Range</span>
                    <input value={config.limit} placeholder="10" onChange={(e) => configure("limit", e.target.value)} />
                  </label>
                  <label className="modal-field"><span>Output variable</span>
                    <input value={config.result} onChange={(e) => configure("result", e.target.value)} />
                  </label>
                </>
              )}
              {["createList", "changeList", "listOperation", "aggregate"].includes(kind) && (
                <>
                  {kind === "createList"
                    ? <label className="modal-field"><span>Entity</span>
                        <input value={config.entity} placeholder="Module.Entity" onChange={(e) => configure("entity", e.target.value)} />
                      </label>
                    : <label className="modal-field"><span>List</span>
                        <input value={config.object} placeholder="$List" onChange={(e) => configure("object", e.target.value)} />
                      </label>}
                  {kind !== "createList" && <label className="modal-field"><span>Operation</span>
                    <select value={config.operation} onChange={(e) => configure("operation", e.target.value)}>
                      {(kind === "changeList" ? ["ADD", "REMOVE"] :
                        kind === "aggregate" ? ["COUNT", "SUM", "AVERAGE", "MINIMUM", "MAXIMUM"] :
                        ["HEAD", "TAIL", "FIND", "FILTER", "SORT", "UNION", "INTERSECT", "SUBTRACT"])
                        .map((operation) => <option key={operation}>{operation}</option>)}
                    </select>
                  </label>}
                  {kind !== "createList" && <label className="modal-field"><span>Value / expression</span>
                    <input value={config.value} onChange={(e) => configure("value", e.target.value)} />
                  </label>}
                  {kind !== "changeList" && <label className="modal-field"><span>Output variable</span>
                    <input value={config.result} onChange={(e) => configure("result", e.target.value)} />
                  </label>}
                </>
              )}
              {["java", "javascript", "microflow", "nanoflow"].includes(kind) && (
                <>
                  <label className="modal-field"><span>Action</span>
                    <input value={config.target} placeholder="Module.Action" onChange={(e) => configure("target", e.target.value)} />
                  </label>
                  <label className="modal-field"><span>Arguments</span>
                    <textarea className="modal-stmt" rows={4} value={config.arguments}
                      placeholder={"Parameter = $Value,\nOther = 'text'"} onChange={(e) => configure("arguments", e.target.value)} />
                  </label>
                  <label className="modal-field"><span>Result variable</span>
                    <input value={config.result} onChange={(e) => configure("result", e.target.value)} />
                  </label>
                </>
              )}
              {kind === "showPage" && (
                <>
                  <label className="modal-field"><span>Page</span>
                    <input value={config.target} placeholder="Module.Page" onChange={(e) => configure("target", e.target.value)} />
                  </label>
                  <label className="modal-field"><span>Arguments</span>
                    <textarea className="modal-stmt" rows={3} value={config.arguments}
                      placeholder="$Parameter = $Object" onChange={(e) => configure("arguments", e.target.value)} />
                  </label>
                </>
              )}
              {kind === "validation" && (
                <>
                  <label className="modal-field"><span>Object</span>
                    <input value={config.object} placeholder="$Object" onChange={(e) => configure("object", e.target.value)} />
                  </label>
                  <label className="modal-field"><span>Member</span>
                    <input value={config.attribute} placeholder="Attribute" onChange={(e) => configure("attribute", e.target.value)} />
                  </label>
                  <label className="modal-field"><span>Message</span>
                    <textarea className="modal-stmt" rows={3} value={config.message}
                      onChange={(e) => configure("message", e.target.value)} />
                  </label>
                </>
              )}
              {kind === "log" && (
                <>
                  <label className="modal-field"><span>Log level</span>
                    <select value={config.level} onChange={(e) => configure("level", e.target.value)}>
                      {["TRACE", "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].map((level) => <option key={level}>{level}</option>)}
                    </select>
                  </label>
                  <label className="modal-field"><span>Log node</span>
                    <input value={config.nodeName} onChange={(e) => configure("nodeName", e.target.value)} />
                  </label>
                  <label className="modal-field"><span>Message template</span>
                    <textarea className="modal-stmt" rows={3} value={config.message}
                      onChange={(e) => configure("message", e.target.value)} />
                  </label>
                </>
              )}
              {node.type === "loop" && (
                <label className="modal-field"><span>Iterate over</span>
                  <select><option>Select a list variable…</option></select>
                </label>
              )}
              {!variableActivity && node.type === "activity" &&
                !["create", "changeObject", "commit", "delete", "rollback", "retrieve",
                  "createList", "changeList", "listOperation", "aggregate", "java",
                  "javascript", "microflow", "nanoflow", "showPage", "validation", "log"].includes(kind) && (
                <div className="flow-action-summary">
                  <span>Configuration</span>
                  <p>Configure this activity in Advanced while its dedicated Model SDK writer is being implemented.</p>
                </div>
              )}
            </>
          )}
          {tab === "common" && (
            <>
              <label className="modal-field"><span>Caption</span>
                <input value={label} autoFocus onChange={(e) => setLabel(e.target.value)} />
              </label>
              <label className="modal-field"><span>Error handling</span>
                <select value={errorHandling} onChange={(e) => setErrorHandling(e.target.value)}>
                  <option>Rollback</option><option>Custom with rollback</option>
                  <option>Custom without rollback</option><option>Continue</option>
                </select>
              </label>
            </>
          )}
          {tab === "advanced" && editableStmt && (
            <label className="modal-field">
              <span>MDL statement {node.type === "decision" ? "(expression)" : ""}</span>
              <textarea className="modal-stmt" value={stmt} spellCheck={false} rows={7}
                placeholder={node.type === "decision" ? "$Object/Attribute = true" : "CALL JAVA ACTION Module.Action ()"}
                onChange={(e) => setStmt(e.target.value)} />
              <span className="modal-hint">Advanced representation; validated by mxcli when the flow is saved.</span>
            </label>
          )}
        </div>
        <div className="modal-actions">
          {onDisconnect && (
            <button
              className="editor-secondary"
              title="Remove this block's arrows and heal the flow line; the block stays on the canvas"
              onClick={onDisconnect}
            >
              ⛓ Disconnect
            </button>
          )}
          <span className="spacer" />
          <button className="editor-secondary" onClick={onClose}>Cancel</button>
          <button className="w-btn" onClick={save}>OK</button>
        </div>
      </div>
    </div>
  );
}

// Build parameter nodes positioned to the left of the start event.
function makeParamNodes(params: Array<{ name?: string; type?: string }>, startX: number, startY: number): Node[] {
  return params.map((p, i) => ({
    id: `param-${i}`,
    type: "parameter",
    position: { x: startX - 160, y: startY + i * 68 - ((params.length - 1) * 34) },
    data: { label: `$${p.name ?? "param"}`, paramType: p.type ?? "Object" },
    draggable: true,
  }));
}

function PersistedFlowInner({ qn, flowType = "microflow", mdl, savedPositions, parameters = [] }: Props) {
  const graph = useMemo(() => flowGraph(mdl), [mdl]);
  const initial = useMemo(() => {
    const positioned = withSavedPositions(graph?.nodes ?? [], savedPositions);
    const startNode = positioned.find((n) => n.type === "start");
    const allNodes = parameters.length
      ? [...makeParamNodes(parameters, startNode?.position.x ?? 0, startNode?.position.y ?? 0), ...positioned]
      : positioned;
    return positionsCollide(allNodes) ? arrangeFlow(allNodes, graph?.edges ?? []) : allNodes;
  }, [graph, savedPositions, parameters]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph?.edges ?? []);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string>();
  const [studioClosed, setStudioClosed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState(0);
  const [editing, setEditing] = useState<Node>();
  const [selectedNode, setSelectedNode] = useState<Node>();
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; node: Node }>();
  const { zoomIn, zoomOut, zoomTo, fitView, screenToFlowPosition } = useReactFlow();
  const reactFlowRef = useRef<HTMLDivElement>(null);
  const detachedDragRef = useRef<string | null>(null);
  const previousTopology = useRef(`${initial.length}:${graph?.edges.length ?? 0}`);

  useEffect(() => {
    setNodes(initial);
    setEdges(graph?.edges ?? []);
    setDirty(false);
    setStatus(undefined);
  }, [graph, initial, setNodes, setEdges]);

  // New/deleted nodes and connections trigger the same tidy-up Studio Pro's
  // snap-to-flow provides. Pure dragging does not, so intentional positioning
  // remains possible.
  useEffect(() => {
    const topology = `${nodes.length}:${edges.length}`;
    if (topology === previousTopology.current) return;
    previousTopology.current = topology;
    setNodes((current) => arrangeFlow(current, edges));
  }, [nodes.length, edges.length, edges, setNodes]);

  useEffect(() => {
    const editSelected = (event: KeyboardEvent) => {
      if (!selectedNode || editing) return;
      if (event.key !== "Enter" && event.key !== "F2") return;
      if ((event.target as HTMLElement)?.matches("input, textarea, select")) return;
      event.preventDefault();
      setEditing(selectedNode);
    };
    window.addEventListener("keydown", editSelected);
    return () => window.removeEventListener("keydown", editSelected);
  }, [selectedNode, editing]);

  const handleChanges = (changes: NodeChange[]) => {
    onNodesChange(changes);
    if (changes.some((change) => change.type === "position")) setDirty(true);
  };

  // Re-wire an existing arrow to a different block.
  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      setEdges((current) => reconnectEdge(oldEdge, connection, current));
      setStatus("Arrow re-wired (unsaved change).");
    },
    [setEdges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) => addEdge({
        ...connection, type: "smoothstep", style: { stroke: "var(--edge)" },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--edge)" },
      }, current));
      setStatus("Arrow added (unsaved change).");
    },
    [setEdges],
  );

  // Approximate node center (positions are top-left corners).
  const nodeCenter = (n: Node) => ({
    x: n.position.x + (n.type === "start" || n.type === "end" ? 18 : 70),
    y: n.position.y + (n.type === "start" || n.type === "end" ? 18 : 28),
  });

  // Distance from point p to the segment a–b.
  const segmentDistance = (
    p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number },
  ) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };

  // Edge whose line passes close to the point, if any.
  const edgeNear = useCallback(
    (p: { x: number; y: number }, threshold = 60): Edge | undefined => {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      let best: Edge | undefined;
      let bestDistance = threshold;
      for (const e of edges) {
        const a = byId.get(e.source);
        const b = byId.get(e.target);
        if (!a || !b) continue;
        const d = segmentDistance(p, nodeCenter(a), nodeCenter(b));
        if (d < bestDistance) { bestDistance = d; best = e; }
      }
      return best;
    },
    [nodes, edges],
  );

  // Insert a new node. When `intoEdge` is given, splice it into that arrow
  // (source→new→target). With no edge, the node lands free-floating — connect
  // it by drawing arrows, or drop it onto the flow line to integrate.
  const insertNode = useCallback(
    (type: string, kind: string, label: string, position?: { x: number; y: number }, intoEdge?: Edge | null, stmt?: string) => {
      const id = `new${added}`;
      setAdded((n) => n + 1);

      let pos = position;
      if (!pos) {
        // Place after the rightmost non-end node
        const rightmost = nodes.reduce(
          (max, n) => (n.type !== "end" ? Math.max(max, n.position.x) : max),
          0,
        );
        const endNode = nodes.find((n) => n.type === "end");
        pos = { x: rightmost + 220, y: endNode?.position.y ?? 40 };
      }

      // Default (toolbar button): splice before the end event.
      let target = intoEdge;
      if (target === undefined) {
        const endNode = nodes.find((n) => n.type === "end");
        target = endNode ? edges.find((e) => e.target === endNode.id) ?? null : null;
      }

      const newNode: Node = { id, type, position: pos, data: { label, kind, stmt } };
      setNodes((cur) => [...cur, newNode]);
      if (target) {
        const spliced = target;
        setEdges((cur) => {
          const without = cur.filter((e) => e.id !== spliced.id);
          return [
            ...without,
            { id: `e-${spliced.source}-${id}`, source: spliced.source, target: id, type: "smoothstep", style: { stroke: "var(--edge)" } },
            { id: `e-${id}-${spliced.target}`, source: id, target: spliced.target, type: "smoothstep", style: { stroke: "var(--edge)" },
              markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--edge)" } },
          ];
        });
        setStatus(`${label} inserted into the flow (unsaved change).`);
      } else {
        setStatus(`${label} added — drop it on the flow line or draw arrows to connect.`);
      }
      setDirty(true);
    },
    [added, nodes, edges, setNodes, setEdges],
  );

  const addBlock = (shortcut: (typeof SHORTCUTS)[number]) =>
    insertNode(shortcut.type, shortcut.kind, shortcut.label);

  // Detach a node from the flow line, healing predecessor→successor so the
  // flow stays connected; the node itself becomes free-floating.
  const disconnectNode = useCallback(
    (id: string) => {
      const incoming = edges.filter((e) => e.target === id);
      const outgoing = edges.filter((e) => e.source === id);
      setEdges((cur) => {
        let next = cur.filter((e) => e.source !== id && e.target !== id);
        if (incoming.length === 1 && outgoing.length === 1) {
          next = [...next, {
            id: `e-${incoming[0].source}-${outgoing[0].target}`,
            source: incoming[0].source,
            target: outgoing[0].target,
            type: "smoothstep", style: { stroke: "var(--edge)" },
          }];
        }
        return next;
      });
      setDirty(true);
      setStatus("Block disconnected — drag it anywhere, reconnect by drawing arrows.");
    },
    [edges, setEdges],
  );

  // Ctrl+drag detaches a connected block from the flow line: its arrows are
  // removed (predecessor→successor healed) and the block moves freely.
  const onNodeDragStart = useCallback(
    (event: MouseEvent | TouchEvent, node: Node) => {
      if (!("ctrlKey" in event) || !event.ctrlKey) return;
      if (node.type === "start" || node.type === "end") return;
      if (!edges.some((e) => e.source === node.id || e.target === node.id)) return;
      detachedDragRef.current = node.id;
      disconnectNode(node.id);
    },
    [edges, disconnectNode],
  );

  // Dragging a free-floating block onto the flow line splices it into the
  // arrow it lands on (connected blocks just move — arrows follow anyway).
  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      // A Ctrl+drag that just detached this block must not re-link it on drop.
      if (detachedDragRef.current === node.id) {
        detachedDragRef.current = null;
        return;
      }
      if (node.type === "start" || node.type === "end") return;
      const connected = edges.some((e) => e.source === node.id || e.target === node.id);
      if (connected) return;
      const hit = edgeNear(nodeCenter(node));
      if (!hit) return;
      setEdges((cur) => {
        const without = cur.filter((e) => e.id !== hit.id);
        return [
          ...without,
          { id: `e-${hit.source}-${node.id}`, source: hit.source, target: node.id, type: "smoothstep", style: { stroke: "var(--edge)" },
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--edge)" } },
          { id: `e-${node.id}-${hit.target}`, source: node.id, target: hit.target, type: "smoothstep", style: { stroke: "var(--edge)" },
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--edge)" } },
        ];
      });
      setDirty(true);
      setStatus("Block linked into the flow (unsaved change).");
    },
    [edges, edgeNear, setEdges],
  );

  // Keyboard deletion (Delete/Backspace via ReactFlow). Start events are
  // protected; deleting a mid-line block heals predecessor→successor so the
  // flow line stays connected. Deleting a selected arrow detaches blocks.
  const onBeforeDelete = useCallback(
    async ({ nodes: doomed, edges: doomedEdges }: { nodes: Node[]; edges: Edge[] }) => {
      const allowed = doomed.filter((n) => n.type !== "start");
      if (!allowed.length && !doomedEdges.length) return false;
      return { nodes: allowed, edges: doomedEdges };
    },
    [],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const gone = new Set(deleted.map((n) => n.id));
      const heals: Edge[] = [];
      deleted.forEach((n) => {
        const incoming = edges.filter((e) => e.target === n.id && !gone.has(e.source));
        const outgoing = edges.filter((e) => e.source === n.id && !gone.has(e.target));
        if (incoming.length === 1 && outgoing.length === 1) {
          heals.push({
            id: `e-${incoming[0].source}-${outgoing[0].target}`,
            source: incoming[0].source,
            target: outgoing[0].target,
            type: "smoothstep", style: { stroke: "var(--edge)" },
          });
        }
      });
      if (heals.length) {
        setEdges((cur) => {
          const ids = new Set(cur.map((e) => e.id));
          return [...cur, ...heals.filter((h) => !ids.has(h.id))];
        });
      }
      setDirty(true);
      setStatus(`${deleted.length === 1 ? "Block" : `${deleted.length} blocks`} deleted (unsaved change).`);
    },
    [edges, setEdges],
  );

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    if (!deleted.length) return;
    setDirty(true);
    setStatus("Arrow removed — block detached from the flow (unsaved change).");
  }, []);

  // Handle drops from the Toolbox (application/flow-node). Dropping on top of
  // the flow line splices into that arrow; dropping elsewhere adds a free node.
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/flow-node");
      if (!raw) return;
      try {
        const { type, kind, label, stmt } = JSON.parse(raw) as { type: string; kind: string; label: string; stmt?: string };
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        insertNode(type, kind, label, pos, edgeNear(pos) ?? null, stmt);
      } catch { /* ignore */ }
    },
    [screenToFlowPosition, insertNode, edgeNear],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/flow-node")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onSaveFlow = useCallback(async () => {
    setSaving(true);
    const positions: NodePosition[] = nodes.map((node) => ({
      id: node.id,
      label: String((node.data as { label?: string }).label ?? ""),
      x: node.position.x,
      y: node.position.y,
    }));
    try {
      const [, flowResult] = await Promise.all([
        saveLayout(qn, positions),
        saveFlow(qn, flowBodyMdl(nodes, edges)),
      ]);
      setStatus(flowResult.message);
      if (flowResult.ok) setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, qn]);

  const onApplyFlow = useCallback(async () => {
    setSaving(true);
    try {
      const flowResult = await saveFlow(qn, flowBodyMdl(nodes, edges));
      if (!flowResult.ok) {
        setStatus(flowResult.message);
        return;
      }
      const result = await applyDraft(qn, "flow", studioClosed);
      setStatus(result.message);
      if (result.ok) setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, qn, studioClosed]);

  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void onSaveFlow();
    };
    window.addEventListener("keydown", saveShortcut);
    return () => window.removeEventListener("keydown", saveShortcut);
  }, [onSaveFlow]);

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
        <button className="flow-tool flow-arrange" title="Auto-arrange flow"
          onClick={() => {
            setNodes((current) => arrangeFlow(current, edges));
            setDirty(true);
            setStatus("Flow automatically arranged.");
            window.setTimeout(() => fitView({ duration: 250, maxZoom: 1 }), 0);
          }}>⇥</button>
        <span className="spacer" />
        {status && <span className="muted">{status}</span>}
        <label className="flow-studio-guard">
          <input type="checkbox" checked={studioClosed} onChange={(event) => setStudioClosed(event.target.checked)} />
          Studio Pro closed
        </label>
        <button
          className="editor-secondary"
          disabled={!dirty || saving}
          title="Validate the microflow changes (Ctrl+S)"
          onClick={() => void onSaveFlow()}
        >
          Validate
        </button>
        <button
          className="w-btn"
          disabled={!studioClosed || saving}
          title="Validate and write the microflow to the source project"
          onClick={() => void onApplyFlow()}
        >
          Apply to project
        </button>
      </div>
      <div className="canvas" ref={reactFlowRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleChanges}
          onEdgesChange={onEdgesChange}
          onReconnect={onReconnect}
          onConnect={onConnect}
          onNodeDoubleClick={(_, node) => setEditing(node)}
          onNodeClick={(_, node) => { setSelectedNode(node); setNodeMenu(undefined); }}
          onPaneClick={() => { setSelectedNode(undefined); setNodeMenu(undefined); }}
          onPaneContextMenu={(event) => event.preventDefault()}
          onNodeContextMenu={(event, node) => {
            event.preventDefault();
            setSelectedNode(node);
            setNodeMenu({ x: event.clientX, y: event.clientY, node });
          }}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          multiSelectionKeyCode="Shift"
          onDrop={onDrop}
          onDragOver={onDragOver}
          deleteKeyCode={["Delete", "Backspace"]}
          onBeforeDelete={onBeforeDelete}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          defaultEdgeOptions={{
            type: "smoothstep", style: { stroke: "var(--edge)", strokeWidth: 1.25 },
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--edge)" },
          }}
          connectionLineType={ConnectionLineType.SmoothStep}
          edgesReconnectable
          panOnDrag={[2]}
          selectionOnDrag
          selectNodesOnDrag={false}
          fitView
          fitViewOptions={{ padding: 0.22, minZoom: 0.45, maxZoom: 1 }}
          snapToGrid
          snapGrid={[10, 10]}
          minZoom={0.15}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--grid)" gap={18} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {nodeMenu && (
        <div className="flow-node-menu" style={{ left: nodeMenu.x, top: nodeMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}>
          <button onClick={() => { setEditing(nodeMenu.node); setNodeMenu(undefined); }}>Properties <kbd>Enter</kbd></button>
          {nodeMenu.node.type !== "start" && nodeMenu.node.type !== "end" && (
            <button onClick={() => { disconnectNode(nodeMenu.node.id); setNodeMenu(undefined); }}>Disconnect from flow</button>
          )}
          <span />
          <button onClick={() => { navigator.clipboard.writeText(String((nodeMenu.node.data as { stmt?: string }).stmt ?? "")); setNodeMenu(undefined); }}>
            Copy action
          </button>
        </div>
      )}
      {editing && (
        <NodeEditModal
          node={editing}
          flowType={flowType}
          parameters={parameters}
          onDisconnect={
            edges.some((e) => e.source === editing.id || e.target === editing.id)
              ? () => { disconnectNode(editing.id); setEditing(undefined); }
              : undefined
          }
          onClose={() => setEditing(undefined)}
          onSave={(label, kind, stmt) => {
            setNodes((current) =>
              current.map((node) =>
                node.id === editing.id
                  ? { ...node, data: { ...node.data, label, kind, stmt: stmt.trim() || undefined } }
                  : node,
              ),
            );
            setDirty(true);
            setEditing(undefined);
            setStatus("Block updated (unsaved change).");
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
