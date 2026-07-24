import { useEffect, useState, type DragEvent } from "react";
import { widgetTree, widgetProps, type WidgetNode } from "../model/page";
import type { ElementDetail } from "../model/types";
import type { Selection } from "./Tree";

// Turn a dropped Toolbox label into a widget node the preview can render.
function widgetFromLabel(label: string): WidgetNode {
  const type = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const props = `Label: '${label}', Content: '${label}'`;
  return { type, name: undefined, props, children: undefined };
}

const CONTAINERS = new Set([
  "layoutgrid", "row", "column", "container", "dataview", "groupbox", "scrollcontainer",
  "tabcontainer", "tabpage", "footer", "snippetcall", "listview", "templategrid", "sidebartoggle",
]);

function Leaf({ w, onSelect }: { w: WidgetNode; onSelect: (qn: string) => void }) {
  const p = widgetProps(w);
  const t = w.type.toLowerCase();

  if (t === "statictext" || t === "dynamictext")
    return <div className="w-text">{p.content ?? p.label ?? "(text)"}</div>;

  if (t === "textbox" || t === "textarea" || t === "datepicker")
    return (
      <label className="w-field">
        <span>{p.label ?? p.attribute ?? w.name}</span>
        <span className="w-input">{p.attribute ?? ""}</span>
      </label>
    );

  if (t === "combobox" || t === "referenceselector" || t === "referencesetselector" || t === "dropdown")
    return (
      <label className="w-field">
        <span>{p.label ?? p.attribute ?? w.name}</span>
        <span className="w-input select">{p.attribute ?? "▾"}</span>
      </label>
    );

  if (t === "checkbox" || t === "radiobuttons")
    return (
      <label className="w-check">
        <span className="box">☑</span> {p.label ?? p.attribute ?? w.name}
      </label>
    );

  if (t === "actionbutton" || t === "button" || t === "microflowtrigger" || t === "linkbutton")
    return (
      <button
        className="w-btn"
        onClick={() => p.action && onSelect(p.action)}
        title={p.action ? "Go to " + p.action : undefined}
      >
        {p.label ?? w.name ?? "Button"}
      </button>
    );

  if (t === "datagrid" || t === "datagrid2" || t === "gallery")
    return <div className="w-grid">▦ {w.name ?? t} {p.dataSource ? `· ${p.dataSource}` : ""}</div>;

  if (t === "image" || t === "staticimage")
    return <div className="w-img">🖼 {w.name ?? "image"}</div>;

  return <div className="w-generic">{w.type}{w.name ? ` · ${w.name}` : ""}</div>;
}

function Node({ w, onSelect }: { w: WidgetNode; onSelect: (qn: string) => void }) {
  const t = w.type.toLowerCase();
  if (!w.children || !CONTAINERS.has(t)) return <Leaf w={w} onSelect={onSelect} />;

  const dir = t === "row" ? "row" : "column";
  const labelled = t !== "layoutgrid" && t !== "row" && t !== "column";
  const p = widgetProps(w);

  return (
    <div className={`w-box w-${t}`} style={{ display: "flex", flexDirection: dir, flex: t === "column" ? 1 : undefined }}>
      {labelled && (
        <div className="w-box-head">
          {w.type}
          {w.name ? ` · ${w.name}` : ""}
          {p.dataSource ? ` · ${p.dataSource}` : ""}
        </div>
      )}
      <div className="w-box-body" style={{ display: "flex", flexDirection: dir, gap: 8, flex: 1 }}>
        {w.children.map((c, i) => (
          <Node key={i} w={c} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

interface Props {
  selection: Selection;
  detail: ElementDetail;
  onSelect: (qn: string) => void;
}

/** Approximate visual layout preview of a page, reconstructed from its MDL. */
export default function PageView({ selection, detail, onSelect }: Props) {
  const [tree, setTree] = useState<WidgetNode | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    setTree(detail.mdl ? widgetTree(detail.mdl) : null);
  }, [detail.mdl]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const raw = e.dataTransfer.getData("application/mrb-item");
    if (!raw) return;
    const item = JSON.parse(raw) as { label: string };
    setTree((prev) => {
      const root: WidgetNode = prev ?? { type: "page", props: "", children: [] };
      return { ...root, children: [...(root.children ?? []), widgetFromLabel(item.label)] };
    });
  };

  const empty = !tree || !tree.children?.length;

  return (
    <div className="pageview">
      <div className="pageview-chrome">
        <span className="dot" /><span className="dot" /><span className="dot" />
        <span className="title">{detail.title ?? selection.label}</span>
        {detail.layout && <span className="layout-tag">{detail.layout}</span>}
      </div>
      <div
        className={"pageview-canvas" + (over ? " drop-over" : "")}
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); }}
        onDragLeave={() => setOver(false)}
      >
        {empty ? (
          <p className="empty pad">This page has no widget body — drop widgets from the Toolbox to start.</p>
        ) : (
          tree!.children!.map((c, i) => <Node key={i} w={c} onSelect={onSelect} />)
        )}
      </div>
    </div>
  );
}
