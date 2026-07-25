import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { widgetTree, widgetProps } from "../model/page";
import {
  type EditableNode,
  withIds,
  emptyPage,
  isContainer,
  STRUCTURAL,
  widgetFromLabel,
  insert,
  move,
  remove,
} from "../model/pageTree";
import { toPageMdl } from "../model/pageMdl";
import { savePage } from "../model/api";
import type { ElementDetail } from "../model/types";
import type { Selection } from "./Tree";
import WidgetProps from "./WidgetProps";

// Visual, Studio Pro-style page builder. Owns an editable widget tree (parsed
// from the page MDL) and supports dragging widgets from the Toolbox into
// containers, reordering by drag, selecting, editing properties, and deleting.

interface Props {
  selection: Selection;
  detail: ElementDetail;
  onSelect: (qn: string) => void;
}

interface DragPayload {
  move?: string;
  label?: string;
}

function readDrag(e: DragEvent): DragPayload {
  const moveId = e.dataTransfer.getData("application/mrb-move");
  if (moveId) return { move: moveId };
  const raw = e.dataTransfer.getData("application/mrb-item");
  if (raw) {
    try {
      return { label: (JSON.parse(raw) as { label: string }).label };
    } catch {
      return {};
    }
  }
  return {};
}

// A widget leaf rendered approximately like Studio Pro.
function WidgetLeaf({ node, onNavigate }: { node: EditableNode; onNavigate: (qn: string) => void }) {
  const p = widgetProps(node);
  const t = node.type.toLowerCase();

  if (t === "statictext" || t === "dynamictext") {
    const render = node.props.match(/RenderMode:\s*([A-Za-z0-9]+)/i)?.[1]?.toLowerCase() ?? "";
    return <div className={`w-text rm-${render || "text"}`}>{p.content ?? p.label ?? "(text)"}</div>;
  }
  if (t === "textbox" || t === "textarea" || t === "datepicker")
    return (
      <label className="w-field">
        <span>{p.label ?? p.attribute ?? node.name}</span>
        <span className="w-input">{p.attribute ?? ""}</span>
      </label>
    );
  if (t === "combobox" || t === "referenceselector" || t === "referencesetselector" || t === "dropdown")
    return (
      <label className="w-field">
        <span>{p.label ?? p.attribute ?? node.name}</span>
        <span className="w-input select">{p.attribute ?? "▾"}</span>
      </label>
    );
  if (t === "checkbox" || t === "radiobuttons")
    return (
      <label className="w-check">
        <span className="box">☑</span> {p.label ?? p.attribute ?? node.name}
      </label>
    );
  if (t === "actionbutton" || t === "button" || t === "microflowtrigger" || t === "linkbutton")
    return (
      <button className="w-btn" onClick={() => p.action && onNavigate(p.action)}>
        {p.label ?? node.name ?? "Button"}
      </button>
    );
  if (t === "datagrid" || t === "datagrid2" || t === "gallery")
    return <div className="w-grid">▦ {node.name ?? t} {p.dataSource ? `· ${p.dataSource}` : ""}</div>;
  if (t === "image" || t === "staticimage") return <div className="w-img">🖼 {node.name ?? "image"}</div>;
  return <div className="w-generic">{node.type}{node.name ? ` · ${node.name}` : ""}</div>;
}

export default function PageBuilder({ selection, detail, onSelect }: Props) {
  const [tree, setTree] = useState<EditableNode>(() => withIds(widgetTree(detail.mdl ?? "") ?? emptyPage()));
  const [selectedId, setSelectedId] = useState<string>();
  const [hint, setHint] = useState<string>(); // "parentId:index" of the active drop slot
  const [mode, setMode] = useState<"structure" | "design">("structure");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string }>();
  const editingRef = useRef(false); // suppress Delete-key when typing in the props panel

  const save = useCallback(async () => {
    setSaving(true);
    setStatus(undefined);
    const result = await savePage(selection.qn, toPageMdl(tree));
    setStatus({ ok: result.ok, message: result.message });
    setSaving(false);
  }, [selection.qn, tree]);

  useEffect(() => {
    setTree(withIds(widgetTree(detail.mdl ?? "") ?? emptyPage()));
    setSelectedId(undefined);
  }, [detail.mdl]);

  const drop = useCallback((e: DragEvent, parentId: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setHint(undefined);
    const payload = readDrag(e);
    if (payload.move) {
      setTree((t) => move(t, payload.move!, parentId, index));
    } else if (payload.label) {
      const node = widgetFromLabel(payload.label);
      setTree((t) => insert(t, parentId, index, node));
      setSelectedId(node.id);
    }
  }, []);

  const del = useCallback((id: string) => {
    setTree((t) => remove(t, id));
    setSelectedId((current) => (current === id ? undefined : current));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !editingRef.current) {
        e.preventDefault();
        del(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, del]);

  const gap = (parentId: string, index: number) => {
    const key = `${parentId}:${index}`;
    return (
      <div
        className={"w-gap" + (hint === key ? " on" : "")}
        onDragOver={(e) => {
          if (readDragTypes(e)) {
            e.preventDefault();
            e.stopPropagation();
            setHint(key);
          }
        }}
        onDragLeave={() => setHint((h) => (h === key ? undefined : h))}
        onDrop={(e) => drop(e, parentId, index)}
      />
    );
  };

  const renderNode = (node: EditableNode) => {
    const t = node.type.toLowerCase();
    const container = isContainer(t) && node.children !== undefined;
    const structural = STRUCTURAL.has(t);
    const selected = node.id === selectedId;
    const dir = t === "row" ? "row" : "column";
    const p = widgetProps(node);

    const body = container ? (
      <div className="w-box-body" style={{ display: "flex", flexDirection: dir, gap: 8, flex: 1 }}>
        {(node.children ?? []).map((child, i) => (
          <div key={child.id} style={{ display: "contents" }}>
            {gap(node.id, i)}
            {renderNode(child)}
          </div>
        ))}
        {gap(node.id, node.children?.length ?? 0)}
        {!node.children?.length && (
          <div
            className="w-drop-empty"
            onDragOver={(e) => {
              if (readDragTypes(e)) {
                e.preventDefault();
                setHint(`${node.id}:0`);
              }
            }}
            onDrop={(e) => drop(e, node.id, 0)}
          >
            Drop widgets here
          </div>
        )}
      </div>
    ) : null;

    return (
      <div
        className={
          (container ? (structural ? "w-struct" : "w-box") : "w-leaf") +
          ` w-${t}` +
          (selected ? " selected" : "")
        }
        style={container ? { display: "flex", flexDirection: dir, flex: t === "column" ? 1 : undefined } : undefined}
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData("application/mrb-move", node.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedId(node.id);
        }}
      >
        {container && !structural && (
          <div className="w-box-head">
            {node.type}
            {node.name ? ` · ${node.name}` : ""}
            {p.dataSource ? ` · ${p.dataSource}` : ""}
          </div>
        )}
        {container ? body : <WidgetLeaf node={node} onNavigate={onSelect} />}
        {selected && (
          <button
            className="w-del"
            title="Delete widget (Del)"
            onClick={(e) => {
              e.stopPropagation();
              del(node.id);
            }}
          >
            ✕
          </button>
        )}
      </div>
    );
  };

  const empty = !tree.children?.length;

  return (
    <div className="pagebuilder">
      <div className="pageview-chrome">
        <span className="dot" /><span className="dot" /><span className="dot" />
        <span className="title">{detail.title ?? selection.label}</span>
        {detail.layout && <span className="layout-tag">{detail.layout}</span>}
        <span className="pb-modes">
          <button className={mode === "structure" ? "on" : ""} onClick={() => setMode("structure")}>
            Structure mode
          </button>
          <button className={mode === "design" ? "on" : ""} onClick={() => setMode("design")}>
            Design mode
          </button>
        </span>
        <span className="spacer" />
        {status && <span className={status.ok ? "pb-ok" : "pb-err"}>{status.message}</span>}
        <button className="w-btn" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save page"}
        </button>
      </div>
      <div className="pb-body">
        <div
          className={"pageview-canvas" + (mode === "design" ? " pb-design" : "")}
          onClick={() => setSelectedId(undefined)}
        >
          {empty ? (
            <div
              className="w-drop-empty large"
              onDragOver={(e) => {
                if (readDragTypes(e)) {
                  e.preventDefault();
                  setHint("root:0");
                }
              }}
              onDrop={(e) => drop(e, tree.id, 0)}
            >
              Drag widgets from the Toolbox to build this page.
            </div>
          ) : (
            <>
              {gap(tree.id, 0)}
              {(tree.children ?? []).map((child, i) => (
                <div key={child.id} style={{ display: "contents" }}>
                  {i > 0 && gap(tree.id, i)}
                  {renderNode(child)}
                </div>
              ))}
              {gap(tree.id, tree.children?.length ?? 0)}
            </>
          )}
        </div>
        <WidgetProps
          node={selectedId ? findInTree(tree, selectedId) : undefined}
          onChange={(props) =>
            selectedId && setTree((t) => updateProps(t, selectedId, props))
          }
          onEditingChange={(editing) => (editingRef.current = editing)}
        />
      </div>
    </div>
  );
}

// dataTransfer.types is available during dragover (getData is not) — use it to
// decide whether this drag is one we accept.
function readDragTypes(e: DragEvent): boolean {
  return e.dataTransfer.types.includes("application/mrb-item") ||
    e.dataTransfer.types.includes("application/mrb-move");
}

function findInTree(root: EditableNode, id: string): EditableNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const hit = findInTree(child, id);
    if (hit) return hit;
  }
  return undefined;
}

function updateProps(root: EditableNode, id: string, props: string): EditableNode {
  if (root.id === id) return { ...root, props };
  if (!root.children) return root;
  return { ...root, children: root.children.map((c) => updateProps(c, id, props)) };
}
