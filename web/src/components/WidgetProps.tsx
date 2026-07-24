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
    return (
      <aside className="wprops">
        <div className="wprops-title">Properties</div>
        <p className="empty pad">Select a widget to edit its properties.</p>
      </aside>
    );
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
    <aside className="wprops">
      <div className="wprops-title">
        {node.type}
        {node.name ? ` · ${node.name}` : ""}
      </div>

      {fields.map((field) => {
        const raw = getProp(pairs, field.key);
        const value = field.quoted ? unquote(raw) : raw ?? "";
        return (
          <label className="wprops-field" key={field.key}>
            <span>{field.label}</span>
            <input
              value={value}
              placeholder={field.placeholder}
              onFocus={() => onEditingChange(true)}
              onBlur={() => onEditingChange(false)}
              onChange={(e) => setField(field, e.target.value)}
            />
          </label>
        );
      })}

      <details className="wprops-raw">
        <summary>Raw MDL props</summary>
        <textarea
          value={node.props}
          rows={4}
          onFocus={() => onEditingChange(true)}
          onBlur={() => onEditingChange(false)}
          onChange={(e) => onChange(e.target.value)}
        />
      </details>
    </aside>
  );
}
