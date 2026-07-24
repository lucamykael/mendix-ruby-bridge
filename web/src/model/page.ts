// Parse a page's MDL into a nested widget tree by walking the brace structure.
// The flat `widgets` list loses nesting; the MDL keeps it (`container { ... }`),
// so we parse that to reconstruct an approximate layout for preview.

export interface WidgetNode {
  type: string;
  name?: string;
  props: string;
  children?: WidgetNode[];
}

function parseHead(raw: string): WidgetNode {
  const s = raw.trim();
  const openParen = s.indexOf("(");
  const head = (openParen === -1 ? s : s.slice(0, openParen)).trim();
  const parts = head.split(/\s+/);
  const type = parts[0] ?? "widget";
  const name = parts[1];
  const props = openParen === -1 ? "" : s.slice(openParen + 1, s.lastIndexOf(")"));
  return { type, name, props };
}

/** Build the widget tree from a page's MDL, or null if there is no widget body. */
export function widgetTree(mdl: string): WidgetNode | null {
  // widget body begins at the first `) {` that closes the page header
  const m = mdl.match(/\)\s*\{/);
  if (!m || m.index == null) return null;
  const start = m.index + m[0].length;
  const body = mdl.slice(start);

  const root: WidgetNode = { type: "page", props: "", children: [] };
  const stack: WidgetNode[] = [root];
  let buf = "";
  let paren = 0;
  let inStr = false;

  const flushLeaf = () => {
    const t = buf.trim();
    if (t && !t.startsWith("--")) stack[stack.length - 1].children!.push(parseHead(t));
    buf = "";
  };

  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === "'" && body[i - 1] !== "\\") inStr = false;
      buf += c;
      continue;
    }
    if (c === "'") { inStr = true; buf += c; continue; }
    if (c === "(") { paren++; buf += c; continue; }
    if (c === ")") { paren--; buf += c; continue; }
    if (paren > 0) { buf += c; continue; }

    if (c === "{") {
      const node = parseHead(buf);
      node.children = [];
      stack[stack.length - 1].children!.push(node);
      stack.push(node);
      buf = "";
    } else if (c === "}") {
      flushLeaf();
      if (stack.length > 1) stack.pop();
      else break; // reached the page's closing brace
    } else if (c === "\n") {
      flushLeaf();
    } else {
      buf += c;
    }
  }
  return root;
}

const RE = (k: string, s: string) => {
  const m = s.match(new RegExp(k + ":\\s*'([^']*)'"));
  return m ? m[1] : undefined;
};

/** Pull display-relevant bits out of a widget's raw props. */
export function widgetProps(w: WidgetNode) {
  return {
    label: RE("Label", w.props) ?? RE("Caption", w.props),
    attribute: w.props.match(/Attribute:\s*([A-Za-z0-9_./]+)/)?.[1],
    content: RE("Content", w.props),
    action: w.props.match(/Action:\s*(?:microflow|nanoflow)?\s*([A-Za-z0-9_.]+)/)?.[1],
    dataSource: w.props.match(/DataSource:\s*([^,)\n]+)/)?.[1]?.trim(),
  };
}

// ---- structured props editing (for the builder's property panel) -----------
// Props are `Key: value` segments joined by top-level commas. We keep them as an
// ordered list so editing a known key preserves unknown ones on serialize.

export interface PropPair {
  key: string;
  value: string;
}

export function parseProps(props: string): PropPair[] {
  const pairs: PropPair[] = [];
  let depth = 0;
  let inStr = false;
  let buf = "";
  const push = () => {
    const seg = buf.trim();
    buf = "";
    if (!seg) return;
    const idx = seg.indexOf(":");
    if (idx === -1) pairs.push({ key: seg, value: "" });
    else pairs.push({ key: seg.slice(0, idx).trim(), value: seg.slice(idx + 1).trim() });
  };
  for (let i = 0; i < props.length; i++) {
    const c = props[i];
    if (inStr) {
      if (c === "'" && props[i - 1] !== "\\") inStr = false;
      buf += c;
      continue;
    }
    if (c === "'") { inStr = true; buf += c; continue; }
    if (c === "(" || c === "{") { depth++; buf += c; continue; }
    if (c === ")" || c === "}") { depth--; buf += c; continue; }
    if (c === "," && depth === 0) { push(); continue; }
    buf += c;
  }
  push();
  return pairs;
}

export function serializeProps(pairs: PropPair[]): string {
  return pairs.filter((p) => p.key).map((p) => (p.value === "" ? p.key : `${p.key}: ${p.value}`)).join(", ");
}

export function getProp(pairs: PropPair[], key: string): string | undefined {
  return pairs.find((p) => p.key.toLowerCase() === key.toLowerCase())?.value;
}

/** Set/remove a key (empty value removes it), preserving order; appends if new. */
export function setProp(pairs: PropPair[], key: string, value: string): PropPair[] {
  const next = pairs.filter((p) => p.key.toLowerCase() !== key.toLowerCase() || value !== "");
  const idx = next.findIndex((p) => p.key.toLowerCase() === key.toLowerCase());
  if (value === "") return next;
  if (idx === -1) return [...next, { key, value }];
  return next.map((p) => (p.key.toLowerCase() === key.toLowerCase() ? { key, value } : p));
}
