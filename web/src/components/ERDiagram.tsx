import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildErDiagram, listErModules, type ErTableData } from "../model/diagram";
import { erNodeTypes } from "./ERTable";
import SqlEditor from "./SqlEditor";
import type { Assoc } from "../model/er";
import type { ElementDetail, TreeNode } from "../model/types";

const POS_KEY = "mrb-er-pos";
const SEL_KEY = "mrb-er-modules";
type PosMap = Record<string, { x: number; y: number }>;
type EditorTab = "diagram" | "sql";

interface SqlCatalogTable {
  module: string;
  entity: string;
  physicalName: string;
  columns: string[];
}

function orientEdges(edges: Edge[], nodes: Node<ErTableData>[]): Edge[] {
  const positions = new Map(nodes.map((node) => [node.id, node.position]));
  return edges.map((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    const sourceOnLeft = !source || !target || source.x <= target.x;
    return {
      ...edge,
      type: "smoothstep",
      sourceHandle: `ref-${edge.id}-${sourceOnLeft ? "right" : "left"}`,
      targetHandle: `target-${sourceOnLeft ? "left" : "right"}`,
    };
  });
}

function loadPositions(): PosMap {
  try { return JSON.parse(localStorage.getItem(POS_KEY) ?? "{}"); } catch { return {}; }
}

function savePositions(nodes: Node<ErTableData>[]) {
  const map = loadPositions();
  for (const node of nodes) map[node.id] = node.position;
  localStorage.setItem(POS_KEY, JSON.stringify(map));
}

function loadSelection(all: string[]): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(SEL_KEY) ?? "null");
    if (Array.isArray(saved)) return new Set(saved.filter((module: string) => all.includes(module)));
  } catch { /* use all modules */ }
  return new Set(all);
}

function entitiesByModule(tree: TreeNode[]): Map<string, Array<{ qn: string; name: string }>> {
  const result = new Map<string, Array<{ qn: string; name: string }>>();
  for (const module of tree.filter((node) => node.type === "module")) {
    const entities: Array<{ qn: string; name: string }> = [];
    const walk = (nodes?: TreeNode[]) => {
      for (const node of nodes ?? []) {
        if (node.type === "entity" && node.qualifiedName)
          entities.push({ qn: node.qualifiedName, name: node.label });
        walk(node.children);
      }
    };
    walk(module.children);
    result.set(module.label, entities.sort((a, b) => a.name.localeCompare(b.name)));
  }
  return result;
}

interface Props {
  tree: TreeNode[];
  details: Record<string, ElementDetail>;
  assocs: Assoc[];
  onOpenEntity: (qn: string) => void;
  initialModule?: string;
}

export default function ERDiagram({ tree, details, assocs, onOpenEntity, initialModule }: Props) {
  const allModules = useMemo(() => listErModules(tree), [tree]);
  const moduleEntities = useMemo(() => entitiesByModule(tree), [tree]);
  const sqlCatalog = useMemo<SqlCatalogTable[]>(() =>
    [...moduleEntities.entries()].flatMap(([module, entities]) =>
      entities.map((entity) => ({
        module,
        entity: entity.name,
        physicalName: `${module.toLowerCase()}$${entity.name.toLowerCase()}`,
        columns: (details[entity.qn]?.attributes ?? []).map((attribute) => attribute.name.toLowerCase()),
      }))),
    [moduleEntities, details],
  );
  const [selected, setSelected] = useState<Set<string>>(() =>
    initialModule ? new Set([initialModule]) : loadSelection(allModules));
  const [tab, setTab] = useState<EditorTab>("diagram");
  const [filter, setFilter] = useState("");
  const [selectedEntity, setSelectedEntity] = useState<string>();
  const [showProperties, setShowProperties] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [flow, setFlow] = useState<ReactFlowInstance<Node<ErTableData>>>();
  const [generatedSql, setGeneratedSql] = useState<string>();

  const base = useMemo(() => buildErDiagram(tree, details, assocs, selected), [tree, details, assocs, selected]);
  const [nodes, setNodes] = useState<Node<ErTableData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    const saved = loadPositions();
    const next = base.nodes.map((node) => saved[node.id] ? { ...node, position: saved[node.id] } : node);
    setNodes(next);
    setEdges(orientEdges(base.edges, next));
  }, [base]);
  useEffect(() => localStorage.setItem(SEL_KEY, JSON.stringify([...selected])), [selected]);

  const onNodesChange = useCallback((changes: NodeChange<Node<ErTableData>>[]) => {
    const next = applyNodeChanges(changes, nodes);
    setNodes(next);
    if (changes.some((change) => change.type === "position"))
      setEdges((currentEdges) => orientEdges(currentEdges, next));
    if (changes.some((change) => change.type === "position" && change.dragging === false)) savePositions(next);
  }, [nodes]);

  const selectModule = (module: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });
  };

  const selectEntity = (qn: string) => {
    const module = qn.split(".")[0];
    setSelected((current) => new Set([...current, module]));
    setSelectedEntity(qn);
    window.setTimeout(() => flow?.fitView({ nodes: [{ id: qn }], duration: 250, padding: 1.2 }), 0);
  };

  const selectedDetail = selectedEntity ? details[selectedEntity] : undefined;
  const selectedNode = nodes.find((node) => node.id === selectedEntity);
  const ddl = selectedNode ? [
    `CREATE TABLE ${selectedNode.data.name.toLowerCase()} (`,
    "  id BIGINT PRIMARY KEY,",
    ...selectedNode.data.attributes.map((attribute, index) =>
      `  ${attribute.name.toLowerCase()} ${attribute.type ?? "TEXT"}${attribute.required ? " NOT NULL" : ""}${index === selectedNode.data.attributes.length - 1 ? "" : ","}`),
    ");",
  ].join("\n") : "";

  const openSelect = (qn: string) => {
    const [module, entity] = qn.split(".");
    const table = module && entity ? `${module.toLowerCase()}$${entity.toLowerCase()}` : qn.toLowerCase();
    setGeneratedSql(`SELECT *\nFROM ${table}\nLIMIT 200;`);
    setTab("sql");
  };

  return (
    <div className="db-workbench">
      <aside className="db-navigator">
        <div className="db-pane-title"><strong>Database Navigator</strong><span>⌃ ⟳ ⋮</span></div>
        <input className="db-filter" placeholder="Filter database objects" value={filter}
          onChange={(event) => setFilter(event.target.value)} />
        <div className="db-tree">
          <details open><summary><span className="db-connection">◆</span> Mendix domain model</summary>
            <details open><summary>▤ Schemas</summary>
              {allModules.filter((module) => module.toLowerCase().includes(filter.toLowerCase()) ||
                moduleEntities.get(module)?.some((entity) => entity.name.toLowerCase().includes(filter.toLowerCase())))
                .map((module) => (
                  <details key={module} open={selected.has(module)}>
                    <summary onClick={(event) => { event.preventDefault(); selectModule(module); }}>
                      <span className="db-schema">▦</span>{module}
                      <span className="db-object-count">{moduleEntities.get(module)?.length ?? 0}</span>
                    </summary>
                    <div className="db-tree-folder">▱ Tables</div>
                    {moduleEntities.get(module)?.filter((entity) => entity.name.toLowerCase().includes(filter.toLowerCase()) ||
                      module.toLowerCase().includes(filter.toLowerCase())).map((entity) => (
                        <button key={entity.qn} className={selectedEntity === entity.qn ? "selected" : ""}
                          onClick={() => selectEntity(entity.qn)}
                          onDoubleClick={() => onOpenEntity(entity.qn)}
                          onContextMenu={(event) => { event.preventDefault(); openSelect(entity.qn); }}>
                          <span>▦</span>{entity.name}
                        </button>
                      ))}
                  </details>
                ))}
            </details>
          </details>
        </div>
        <div className="db-project-pane">
          <div className="db-pane-title"><strong>Projects</strong><span>＋ ⟳</span></div>
          <div>▾ Project - Mendix</div>
          <div className="db-project-child">▱ ER Diagrams</div>
          <div className="db-project-child" onDoubleClick={() => setTab("sql")}>▱ Scripts</div>
        </div>
      </aside>

      <main className="db-editor-area">
        <div className="db-object-tabs">
          <button className={tab === "diagram" ? "active" : ""} onClick={() => setTab("diagram")}>▧ ER Diagram</button>
          <button className={tab === "sql" ? "active" : ""} onClick={() => setTab("sql")}><span className="db-sql-icon">SQL</span> SQL Editor</button>
        </div>
        {tab === "sql" ? <SqlEditor insertSql={generatedSql} catalog={sqlCatalog} /> : (
          <>
            <div className="db-er-toolbar">
              <button title="Refresh" onClick={() => setNodes([...nodes])}>⟳</button>
              <button title="Keep layout" onClick={() => savePositions(nodes)}>💾</button>
              <span className="db-toolbar-sep" />
              <button title="Zoom out" onClick={() => flow?.zoomOut()}>−</button>
              <span className="db-zoom">100%</span>
              <button title="Zoom in" onClick={() => flow?.zoomIn()}>＋</button>
              <button title="Fit diagram" onClick={() => flow?.fitView({ duration: 250, padding: .15 })}>⛶</button>
              <button title="Auto-arrange" onClick={() => {
                setNodes(base.nodes);
                setEdges(orientEdges(base.edges, base.nodes));
                window.setTimeout(() => flow?.fitView({ duration: 250 }), 0);
              }}>⇥ Auto arrange</button>
              <button className={showGrid ? "active" : ""} onClick={() => setShowGrid((value) => !value)}># Grid</button>
              <span className="db-toolbar-sep" />
              <button disabled={!selectedEntity} onClick={() => selectedEntity && openSelect(selectedEntity)}>SQL</button>
              <button className={showProperties ? "active" : ""} onClick={() => setShowProperties((value) => !value)}>Properties</button>
              <span className="db-er-count">{nodes.length} tables · {base.edges.length} relationships</span>
            </div>
            <div className="db-diagram-content">
              <div className="er-canvas">
                {nodes.length === 0 ? <p className="empty pad">Select schemas in Database Navigator.</p> : (
                  <ReactFlow nodes={nodes} edges={edges} nodeTypes={erNodeTypes}
                    onInit={setFlow} onNodesChange={onNodesChange} fitView minZoom={.1}
                    proOptions={{ hideAttribution: true }}
                    onNodeClick={(_, node) => setSelectedEntity(node.id)}
                    onNodeDoubleClick={(_, node) => onOpenEntity(node.id)}>
                    {showGrid && <Background color="var(--grid)" gap={18} />}
                    <Controls showInteractive={false} />
                  </ReactFlow>
                )}
              </div>
              {showProperties && (
                <aside className="db-properties">
                  <div className="db-pane-title"><strong>Properties</strong><button onClick={() => setShowProperties(false)}>×</button></div>
                  {selectedEntity && selectedDetail ? (
                    <>
                      <div className="db-prop-tabs"><button className="active">Properties</button><button>DDL</button></div>
                      <dl>
                        <dt>Name</dt><dd>{selectedNode?.data.name}</dd>
                        <dt>Qualified name</dt><dd>{selectedEntity}</dd>
                        <dt>Module</dt><dd>{selectedNode?.data.module}</dd>
                        <dt>Persistent</dt><dd>{selectedDetail.persistable === false ? "No" : "Yes"}</dd>
                        <dt>Attributes</dt><dd>{selectedNode?.data.attributes.length ?? 0}</dd>
                        <dt>Associations</dt><dd>{selectedNode?.data.refs.length ?? 0}</dd>
                      </dl>
                      <pre>{ddl}</pre>
                      <button className="db-open-data" onClick={() => openSelect(selectedEntity)}>Open SQL console</button>
                    </>
                  ) : <div className="db-empty-properties">Select a table to inspect its properties.</div>}
                </aside>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
