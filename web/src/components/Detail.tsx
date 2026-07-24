import type { ElementDetail } from "../model/types";
import type { Selection } from "./Tree";

interface Props {
  selection: Selection;
  detail: ElementDetail;
  onSelect: (qn: string) => void;
}

const isQn = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_]+\.[A-Za-z0-9_]+/.test(s);

const ORDER = [
  "parameters", "widget_types", "widgets", "data_sources", "attributes", "actions",
  "microflow_calls", "nanoflow_calls", "page_links", "view_roles", "access_rules",
  "execute_roles", "variables", "activities", "calls", "generalization",
];

function Value({ v, onSelect }: { v: unknown; onSelect: (qn: string) => void }) {
  if (isQn(v))
    return (
      <a className="ref" onClick={() => onSelect((v as string).split(/[\s(]/)[0])}>
        {v}
      </a>
    );
  if (v == null) return <span className="empty">—</span>;
  if (typeof v === "object") return <code>{JSON.stringify(v)}</code>;
  return <span>{String(v)}</span>;
}

function ArrayBlock({ arr, onSelect }: { arr: unknown[]; onSelect: (qn: string) => void }) {
  if (!arr.length) return <p className="empty">none</p>;
  const objs = arr.every((x) => x && typeof x === "object" && !Array.isArray(x));
  if (objs) {
    const cols: string[] = [];
    (arr as Record<string, unknown>[]).forEach((o) => Object.keys(o).forEach((k) => !cols.includes(k) && cols.push(k)));
    return (
      <table>
        <thead>
          <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {(arr as Record<string, unknown>[]).map((o, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>
                  <Value v={o[c]} onSelect={onSelect} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <ul className="scalars">
      {arr.map((v, i) => (
        <li key={i}>
          <Value v={v} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

export default function Detail({ selection, detail, onSelect }: Props) {
  const keys = Object.keys(detail)
    .filter((k) => k !== "parse_status" && k !== "mdl")
    .sort((a, b) => {
      const ia = ORDER.indexOf(a);
      const ib = ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

  return (
    <div className="detail">
      <h2>{selection.label}</h2>
      <div className="qn">
        {selection.type} · {selection.qn}
        {detail.parse_status && <span className={"pill " + (detail.parse_status === "parsed" ? "ok" : "warn")}>{detail.parse_status}</span>}
      </div>
      {keys.map((k) => {
        const v = detail[k];
        return (
          <section className="block" key={k}>
            <h3>{k.replace(/_/g, " ")}</h3>
            <div className="body">
              {Array.isArray(v) ? (
                <ArrayBlock arr={v} onSelect={onSelect} />
              ) : v && typeof v === "object" ? (
                <table>
                  <tbody>
                    {Object.entries(v).map(([kk, vv]) => (
                      <tr key={kk}>
                        <th>{kk}</th>
                        <td><Value v={vv} onSelect={onSelect} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Value v={v} onSelect={onSelect} />
              )}
            </div>
          </section>
        );
      })}
      {detail.mdl && (
        <section className="block">
          <h3>MDL</h3>
          <pre>{detail.mdl}</pre>
        </section>
      )}
    </div>
  );
}
