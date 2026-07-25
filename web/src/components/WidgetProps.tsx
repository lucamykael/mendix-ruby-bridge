import { parseProps, serializeProps, getProp, setProp } from "../model/page";
import type { EditableNode } from "../model/pageTree";

// Property panel for the selected widget. Edits map to MDL prop keys; unknown
// props are preserved (via the ordered pair model) and editable raw at the bottom.

interface Field {
  key: string;
  label: string;
  quoted?: boolean;
  placeholder?: string;
}

function fieldsFor(type: string): Field[] {
  const t = type.toLowerCase();
  if (t === "statictext" || t === "dynamictext")
    return [{ key: "Content", label: "Text", quoted: true }];
  if (["textbox", "textarea", "datepicker", "combobox", "dropdown", "checkbox", "radiobuttons", "referenceselector", "referencesetselector"].includes(t))
    return [
      { key: "Label", label: "Label", quoted: true },
      { key: "Attribute", label: "Attribute", placeholder: "AttributeName" },
    ];
  if (["button", "actionbutton", "linkbutton", "microflowtrigger"].includes(t))
    return [
      { key: "Caption", label: "Caption", quoted: true },
      { key: "Action", label: "Action", placeholder: "MICROFLOW Module.MF" },
    ];
  if (["dataview", "datagrid2", "datagrid", "listview", "gallery", "templategrid"].includes(t))
    return [{ key: "DataSource", label: "Data source", placeholder: "$object" }];
  if (t === "groupbox" || t === "footer" || t === "header")
    return [{ key: "Caption", label: "Caption", quoted: true }];
  return [];
}

function unquote(value: string | undefined): string {
  if (!value) return "";
  const m = value.match(/^'(.*)'$/s);
  return (m ? m[1] : value).replace(/''/g, "'");
}

interface Props {
  node?: EditableNode;
  onChange: (props: string) => void;
  onEditingChange: (editing: boolean) => void;
}

export default function WidgetProps({ node, onChange, onEditingChange }: Props) {
  if (!node) {
    return <p className="rp-empty">Select a widget to edit its properties.</p>;
  }

  const pairs = parseProps(node.props);
  const fields = fieldsFor(node.type);

  const setField = (field: Field, input: string) => {
    const value = field.quoted
      ? input
        ? `'${input.replace(/'/g, "''")}'`
        : ""
      : input.trim();
    onChange(serializeProps(setProp(pairs, field.key, value)));
  };

  return (
    <div className="rp-props">
      <div className="rp-props-head">
        <span className="rp-props-type">{node.type}</span>
        <span className="rp-props-label">{node.name ?? ""}</span>
      </div>

      {fields.map((field) => {
        const raw = getProp(pairs, field.key);
        const value = field.quoted ? unquote(raw) : raw ?? "";
        return (
          <div className="rp-prop-row rp-prop-edit" key={field.key}>
            <span className="rp-prop-key">{field.label}</span>
            <input
              className="rp-prop-input"
              value={value}
              placeholder={field.placeholder}
              onFocus={() => onEditingChange(true)}
              onBlur={() => onEditingChange(false)}
              onChange={(e) => setField(field, e.target.value)}
            />
          </div>
        );
      })}

      <details className="rp-prop-raw">
        <summary className="rp-prop-key">Raw MDL props</summary>
        <textarea
          className="rp-prop-textarea"
          value={node.props}
          rows={5}
          onFocus={() => onEditingChange(true)}
          onBlur={() => onEditingChange(false)}
          onChange={(e) => onChange(e.target.value)}
        />
      </details>
    </div>
  );
}
