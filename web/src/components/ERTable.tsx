import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ErTableData } from "../model/diagram";

// A dbdiagram.io-style table card for one Mendix entity: coloured header, one row
// per attribute (name + type), then reference rows (the FK analogue) that anchor a
// relationship line. Colours come from theme CSS variables so it tracks the theme.
export default function ERTable({ data }: NodeProps) {
  const d = data as ErTableData;
  return (
    <div className="er-table">
      {/* single incoming anchor on the left, vertically centred */}
      <Handle type="target" position={Position.Left} className="er-handle" />

      <div className="er-th">
        <span className="er-name">{d.name}</span>
        {!d.persistable && <span className="er-badge">non-persistent</span>}
      </div>
      {d.generalization && <div className="er-gen">↳ {d.generalization}</div>}

      <div className="er-body">
        {d.attributes.map((a) => (
          <div className="er-row" key={a.name}>
            <span className="er-col">
              {a.required && <span className="er-req" title="required">•</span>}
              {a.name}
            </span>
            <span className="er-type">{a.type ?? ""}</span>
          </div>
        ))}

        {d.refs.map((ref) => (
          <div className="er-row er-ref" key={ref.qn}>
            <span className="er-col">
              <span className="er-link" title="association">🔗</span>
              {ref.targetName}
            </span>
            <span className="er-type">{ref.many ? "* ref" : "ref"}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={`ref-${ref.qn}`}
              className="er-handle"
            />
          </div>
        ))}

        {!d.attributes.length && !d.refs.length && (
          <div className="er-row er-empty">no attributes</div>
        )}
      </div>
    </div>
  );
}

export const erNodeTypes = { erTable: ERTable };
