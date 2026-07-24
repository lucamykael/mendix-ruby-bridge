import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildErDiagram, listErModules, type ErTableData } from "../model/diagram";
import { erNodeTypes } from "./ERTable";
import type { Assoc } from "../model/er";
import type { ElementDetail, TreeNode } from "../model/types";

// Whole-project ER diagram (dbdiagram.io style). Like DBeaver, you pick any number
// of modules to compose the diagram. Table positions persist globally by entity QN
// (independent of which modules are shown), and the module selection persists too —
// both in localStorage, since /api/layout only accepts existing element QNs.

const POS_KEY = "mrb-er-pos";
const SEL_KEY = "mrb-er-modules";

type PosMap = Record<string, { x: number; y: number }>;

function loadPositions(): PosMap {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

// Merge the shown tables' positions into the global map so hidden tables keep theirs.
function savePositions(nodes: Node<ErTableData>[]) {
  const map = loadPositions();
  for (const n of nodes) map[n.id] = n.position;
  localStorage.setItem(POS_KEY, JSON.stringify(map));
}

function loadSelection(all: string[]): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(SEL_KEY) ?? "null");
    if (Array.isArray(saved)) return new Set(saved.filter((m: string) => all.includes(m)));
  } catch {
    /* fall through */
  }
  return new Set(all);
}

interface Props {
  tree: TreeNode[];
  details: Record<string, ElementDetail>;
  assocs: Assoc[];
  onOpenEntity: (qn: string) => void;
}

export default function ERDiagram({ tree, details, assocs, onOpenEntity }: Props) {
  const allModules = useMemo(() => listErModules(tree), [tree]);
  const [selected, setSelected] = useState<Set<string>>(() => loadSelection(allModules));

  const base = useMemo(
    () => buildErDiagram(tree, details, assocs, selected),
    [tree, details, assocs, selected],
  );
  const [nodes, setNodes] = useState<Node<ErTableData>[]>([]);

  // Rebuild when the selection changes, applying any saved positions.
  useEffect(() => {
    const saved = loadPositions();
    setNodes(base.nodes.map((n) => (saved[n.id] ? { ...n, position: saved[n.id] } : n)));
  }, [base]);

  useEffect(() => {
    localStorage.setItem(SEL_KEY, JSON.stringify([...selected]));
  }, [selected]);

  const onNodesChange = useCallback((changes: NodeChange<Node<ErTableData>>[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      if (changes.some((c) => c.type === "position" && c.dragging === false)) savePositions(next);
      return next;
    });
  }, []);

  const toggle = (module: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });

  return (
    <div className="er-view">
      <div className="er-toolbar">
        <span className="er-filter-label">Modules</span>
        <div className="er-chips">
          {allModules.map((m) => (
            <button
              key={m}
              className={selected.has(m) ? "er-chip on" : "er-chip"}
              onClick={() => toggle(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="er-mini" onClick={() => setSelected(new Set(allModules))}>All</button>
        <button className="er-mini" onClick={() => setSelected(new Set())}>None</button>
        <span className="er-count">
          {nodes.length} tables · {base.edges.length} relationships
        </span>
      </div>
      <div className="er-canvas">
        {nodes.length === 0 ? (
          <p className="empty pad">Select one or more modules to compose the diagram.</p>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={base.edges}
            nodeTypes={erNodeTypes}
            onNodesChange={onNodesChange}
            fitView
            minZoom={0.1}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => onOpenEntity(node.id)}
          >
            <Background color="var(--grid)" gap={18} />
            <MiniMap pannable zoomable maskColor="rgba(0,0,0,0.45)" nodeColor="var(--accent)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
