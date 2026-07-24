import { useEffect, useState } from "react";
import {
  planEntity,
  type EditableAttribute,
  type EntityPlanResult,
} from "../model/api";
import type { Attribute, ElementDetail } from "../model/types";

const TYPES = [
  "string", "boolean", "integer", "long", "decimal", "datetime",
  "autonumber", "binary", "hash_string", "enumeration",
];

function editable(attribute: Attribute): EditableAttribute {
  const raw = attribute.type ?? "String(200)";
  const string = raw.match(/^String\((unlimited|\d+)\)$/i);
  const enumeration = raw.match(/^Enumeration\((.+)\)$/i);
  return {
    name: attribute.name,
    type: string ? "string" : enumeration ? "enumeration" : raw.toLowerCase(),
    required: attribute.required ?? false,
    length: string ? (string[1] === "unlimited" ? null : Number(string[1])) : undefined,
    enumeration: enumeration?.[1],
    default: attribute.default,
  };
}

export default function EntityEditor({
  qn,
  detail,
}: {
  qn: string;
  detail: ElementDetail;
}) {
  const [open, setOpen] = useState(false);
  const [persistable, setPersistable] = useState(detail.persistable ?? true);
  const [attributes, setAttributes] = useState<EditableAttribute[]>([]);
  const [plan, setPlan] = useState<EntityPlanResult>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPersistable(detail.persistable ?? true);
    setAttributes((detail.attributes ?? []).map(editable));
    setPlan(undefined);
    setOpen(false);
  }, [qn, detail]);

  const update = (index: number, patch: Partial<EditableAttribute>) => {
    setAttributes((current) =>
      current.map((attribute, position) =>
        position === index ? { ...attribute, ...patch } : attribute
      )
    );
    setPlan(undefined);
  };

  const preview = async () => {
    setBusy(true);
    const response = await planEntity(qn, persistable, attributes);
    setPlan(response.data);
    setBusy(false);
  };

  if (!open) {
    return (
      <button className="editor-open" onClick={() => setOpen(true)}>
        Edit entity
      </button>
    );
  }

  return (
    <section className="entity-editor">
      <div className="editor-head">
        <div>
          <strong>Visual entity draft</strong>
          <span>Preview only — the Mendix project is not modified.</span>
        </div>
        <button className="editor-secondary" onClick={() => setOpen(false)}>Close</button>
      </div>

      <label className="editor-check">
        <input
          type="checkbox"
          checked={persistable}
          onChange={(event) => { setPersistable(event.target.checked); setPlan(undefined); }}
        />
        Persistent entity
      </label>

      <div className="editor-attributes">
        <div className="editor-row editor-labels">
          <span>Name</span><span>Type</span><span>Options</span><span>Required</span><span />
        </div>
        {attributes.map((attribute, index) => (
          <div className="editor-row" key={`${index}-${attribute.name}`}>
            <input
              value={attribute.name}
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <select
              value={attribute.type}
              onChange={(event) => update(index, { type: event.target.value })}
            >
              {TYPES.map((type) => <option key={type}>{type}</option>)}
            </select>
            {attribute.type === "string" ? (
              <input
                type="number"
                min="1"
                placeholder="unlimited"
                value={attribute.length ?? ""}
                onChange={(event) => update(index, {
                  length: event.target.value ? Number(event.target.value) : null,
                })}
              />
            ) : attribute.type === "enumeration" ? (
              <input
                placeholder="Module.Enum"
                value={attribute.enumeration ?? ""}
                onChange={(event) => update(index, { enumeration: event.target.value })}
              />
            ) : <span className="editor-na">—</span>}
            <input
              type="checkbox"
              checked={attribute.required}
              onChange={(event) => update(index, { required: event.target.checked })}
            />
            <button
              className="editor-danger"
              title="Removal will be shown as blocked until explicitly supported"
              onClick={() => {
                setAttributes((current) => current.filter((_, position) => position !== index));
                setPlan(undefined);
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="editor-actions">
        <button
          className="editor-secondary"
          onClick={() => {
            setAttributes((current) => [
              ...current,
              { name: `NewAttribute${current.length + 1}`, type: "string", length: 200, required: false },
            ]);
            setPlan(undefined);
          }}
        >
          Add attribute
        </button>
        <button className="w-btn" disabled={busy} onClick={preview}>
          {busy ? "Planning…" : "Preview and save draft"}
        </button>
      </div>

      {plan && (
        <div className={`editor-plan ${plan.blocked ? "blocked" : "safe"}`}>
          <strong>{plan.operation.action.toUpperCase()}</strong>
          {plan.operation.reason && <p>{plan.operation.reason}</p>}
          {plan.operation.changes && <pre>{JSON.stringify(plan.operation.changes, null, 2)}</pre>}
          {plan.mdl && (
            <details>
              <summary>Generated MDL preview</summary>
              <pre>{plan.mdl}</pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
