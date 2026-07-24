# frozen_string_literal: true

require "json"

module MendixBridge
  # Generates a self-contained HTML viewer for an imported Mendix inventory.
  #
  # The viewer embeds the project tree and per-element details as JSON, so the
  # produced file works offline from a plain file:// URL with no server. It is a
  # read-only view over the artifacts written by `mendix-ruby import`.
  module HtmlViewer
    TREE_FILE = File.join("inventory", "project-tree.json")
    DETAILS_FILE = File.join("inventory", "element-details.json")
    METADATA_FILE = "mendix-project.json"

    module_function

    # Render the viewer HTML for an imported directory.
    def render(imported_dir)
      tree = load_json(File.join(imported_dir, TREE_FILE))
      details = load_json(File.join(imported_dir, DETAILS_FILE))
      metadata = optional_json(File.join(imported_dir, METADATA_FILE))

      TEMPLATE
        .gsub("__TREE_JSON__", embed(tree))
        .gsub("__DETAILS_JSON__", embed(details))
        .gsub("__META_JSON__", embed(metadata))
    end

    # Render and write the viewer, returning the output path.
    def write(imported_dir, output = nil)
      output ||= File.join(imported_dir, "inventory-viewer.html")
      File.write(output, render(imported_dir))
      output
    end

    def load_json(path)
      raise ArgumentError, "missing inventory file: #{path}" unless File.file?(path)

      JSON.parse(File.read(path))
    end

    def optional_json(path)
      File.file?(path) ? JSON.parse(File.read(path)) : {}
    end

    # Escape a JSON payload so it can live inside a <script> tag safely.
    def embed(data)
      JSON.generate(data).gsub("</", %q{<\/})
    end

    TEMPLATE = <<~'HTML'
      <!doctype html>
      <html lang="en">
      <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Mendix Inventory Viewer</title>
      <style>
        :root {
          --bg: #0f1420; --panel: #161d2b; --panel2: #1d2636; --line: #2a3547;
          --fg: #d7e0ee; --muted: #8595ac; --accent: #6ea8fe; --accent2: #4ade80;
          --chip: #24304a; --code: #0c1018;
        }
        * { box-sizing: border-box; }
        body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--fg); }
        header { display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
          padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--line); }
        header h1 { font-size: 15px; margin: 0; font-weight: 600; }
        header .meta { color: var(--muted); font-size: 12px; }
        header .spacer { flex: 1; }
        header input[type=search] { background: var(--panel2); border: 1px solid var(--line);
          color: var(--fg); padding: 6px 10px; border-radius: 6px; width: 240px; }
        header label { color: var(--muted); font-size: 12px; user-select: none; cursor: pointer; }
        .layout { display: flex; height: calc(100vh - 49px); }
        aside { width: 380px; min-width: 240px; overflow: auto; border-right: 1px solid var(--line);
          background: var(--panel); padding: 8px 0; resize: horizontal; }
        main { flex: 1; overflow: auto; padding: 20px 28px; }
        ul.tree { list-style: none; margin: 0; padding: 0; }
        ul.tree ul { list-style: none; margin: 0; padding-left: 16px; }
        .node { display: flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 5px;
          cursor: pointer; white-space: nowrap; }
        .node:hover { background: var(--panel2); }
        .node.selected { background: #23406b; }
        .node .twist { width: 12px; color: var(--muted); font-size: 10px; flex: none; }
        .node .icon { flex: none; }
        .node .label { overflow: hidden; text-overflow: ellipsis; }
        .node .count { color: var(--muted); font-size: 11px; }
        .collapsed > ul { display: none; }
        .badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px;
          background: var(--chip); color: var(--muted); }
        .hidden { display: none !important; }
        main h2 { margin: 0 0 2px; font-size: 20px; }
        main .qn { color: var(--muted); font-family: ui-monospace, monospace; font-size: 12px; margin-bottom: 18px; }
        section.block { background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
          margin-bottom: 16px; overflow: hidden; }
        section.block > h3 { margin: 0; padding: 8px 14px; font-size: 12px; text-transform: uppercase;
          letter-spacing: .04em; color: var(--muted); background: var(--panel2); border-bottom: 1px solid var(--line); }
        section.block .body { padding: 12px 14px; }
        table { border-collapse: collapse; width: 100%; font-size: 13px; }
        th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
        th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; }
        tr:last-child td { border-bottom: none; }
        pre { margin: 0; padding: 12px 14px; background: var(--code); border-radius: 6px; overflow: auto;
          font: 12px/1.5 ui-monospace, monospace; color: #cbd5e1; }
        .kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
        .kv dt { color: var(--muted); }
        .kv dd { margin: 0; }
        code.inline { background: var(--code); padding: 1px 5px; border-radius: 4px;
          font: 12px ui-monospace, monospace; }
        .empty { color: var(--muted); font-style: italic; }
        .pill { font-size: 11px; padding: 1px 7px; border-radius: 10px; background: var(--chip); margin-left: 6px; }
        .pill.ok { background: #14351f; color: var(--accent2); }
        .pill.warn { background: #3a2a12; color: #fbbf24; }
        a.ref { color: var(--accent); cursor: pointer; text-decoration: none; }
        a.ref:hover { text-decoration: underline; }
      </style>
      </head>
      <body>
      <header>
        <h1>Mendix Inventory Viewer</h1>
        <span class="meta" id="meta"></span>
        <span class="spacer"></span>
        <input type="search" id="search" placeholder="Filter by name…" autocomplete="off">
        <label><input type="checkbox" id="pagesOnly"> Pages only</label>
      </header>
      <div class="layout">
        <aside><ul class="tree" id="tree"></ul></aside>
        <main id="detail"><p class="empty">Select an element on the left to see its details.</p></main>
      </div>

      <script type="application/json" id="data-tree">__TREE_JSON__</script>
      <script type="application/json" id="data-details">__DETAILS_JSON__</script>
      <script type="application/json" id="data-meta">__META_JSON__</script>
      <script>
      (function () {
        const TREE = JSON.parse(document.getElementById("data-tree").textContent);
        const DETAILS = JSON.parse(document.getElementById("data-details").textContent);
        const META = JSON.parse(document.getElementById("data-meta").textContent);

        const ICONS = {
          module: "📦", folder: "📁", page: "📄", entity: "🗄️", association: "🔗",
          microflow: "⚙️", nanoflow: "🔧", enumeration: "🔤", layout: "🧩", snippet: "✂️",
          domainmodel: "🗂️", security: "🔒", projectsecurity: "🔒", userrole: "👤",
          modulerole: "👤", navigation: "🧭", settings: "⚙️", javascriptaction: "🟨",
          javaaction: "☕", buildingblock: "🧱", pagetemplate: "📑", imagecollection: "🖼️",
          constant: "🔢", jsonstructure: "{}", importmapping: "⬇️", exportmapping: "⬆️",
          systemoverview: "🌐", workflow: "🔀"
        };
        const icon = (t) => ICONS[t] || "•";

        const nodes = document.getElementById("tree");
        const detail = document.getElementById("detail");
        const search = document.getElementById("search");
        const pagesOnly = document.getElementById("pagesOnly");

        // ---- metadata line -------------------------------------------------
        const metaBits = [];
        if (META.source_project) metaBits.push(META.source_project.split("/").pop());
        if (META.imported_at) metaBits.push("imported " + META.imported_at);
        if (META.element_count) metaBits.push(META.element_count + " elements");
        document.getElementById("meta").textContent = metaBits.join(" · ");

        // ---- tree building -------------------------------------------------
        let selectedEl = null;
        const byQn = {}; // qualifiedName -> node <li>

        function childrenOf(n) { return n.children || n.nodes || []; }

        function makeNode(n) {
          const li = document.createElement("li");
          li.dataset.type = n.type || "";
          li.dataset.qn = n.qualifiedName || "";
          li.dataset.label = (n.label || n.qualifiedName || "").toLowerCase();

          const kids = childrenOf(n);
          const row = document.createElement("div");
          row.className = "node";

          const twist = document.createElement("span");
          twist.className = "twist";
          twist.textContent = kids.length ? "▶" : "";
          row.appendChild(twist);

          const ic = document.createElement("span");
          ic.className = "icon";
          ic.textContent = icon(n.type);
          row.appendChild(ic);

          const label = document.createElement("span");
          label.className = "label";
          label.textContent = n.label || n.qualifiedName || "(unnamed)";
          row.appendChild(label);

          if (kids.length) {
            const c = document.createElement("span");
            c.className = "count";
            c.textContent = kids.length;
            row.appendChild(c);
          }

          const hasDetail = n.qualifiedName && DETAILS[n.qualifiedName];
          row.addEventListener("click", (ev) => {
            ev.stopPropagation();
            if (kids.length && ev.target === twist) { li.classList.toggle("collapsed"); return; }
            if (kids.length && !hasDetail) { li.classList.toggle("collapsed"); return; }
            if (hasDetail) selectNode(li, n);
            else if (kids.length) li.classList.toggle("collapsed");
          });

          li.appendChild(row);
          if (n.qualifiedName) byQn[n.qualifiedName] = li;

          if (kids.length) {
            const ul = document.createElement("ul");
            kids.forEach((k) => ul.appendChild(makeNode(k)));
            li.appendChild(ul);
            if (n.type === "module" || n.type === "folder") li.classList.add("collapsed");
          }
          return li;
        }

        (Array.isArray(TREE) ? TREE : [TREE]).forEach((n) => nodes.appendChild(makeNode(n)));

        function selectNode(li, n) {
          if (selectedEl) selectedEl.classList.remove("selected");
          selectedEl = li.querySelector(".node");
          selectedEl.classList.add("selected");
          renderDetail(n);
        }

        function selectByQn(qn) {
          const li = byQn[qn];
          if (!li) return;
          // expand ancestors
          let p = li.parentElement;
          while (p && p !== nodes) {
            if (p.tagName === "LI") p.classList.remove("collapsed");
            p = p.parentElement;
          }
          li.querySelector(".node").click();
          li.scrollIntoView({ block: "center" });
        }
        window.__selectByQn = selectByQn;

        // ---- filtering -----------------------------------------------------
        function applyFilter() {
          const q = search.value.trim().toLowerCase();
          const only = pagesOnly.checked;
          function visit(li) {
            const type = li.dataset.type;
            const label = li.dataset.label;
            const childLis = Array.from(li.children).filter((c) => c.tagName === "UL")
              .flatMap((ul) => Array.from(ul.children));
            let anyChild = false;
            childLis.forEach((c) => { if (visit(c)) anyChild = true; });
            const selfMatch = (!only || type === "page") && (!q || label.includes(q));
            const show = selfMatch || anyChild;
            li.classList.toggle("hidden", !show);
            if (anyChild && (q || only)) li.classList.remove("collapsed");
            return show;
          }
          Array.from(nodes.children).forEach(visit);
        }
        search.addEventListener("input", applyFilter);
        pagesOnly.addEventListener("change", applyFilter);

        // ---- detail rendering ---------------------------------------------
        const el = (tag, cls, txt) => {
          const e = document.createElement(tag);
          if (cls) e.className = cls;
          if (txt != null) e.textContent = txt;
          return e;
        };

        // fields that are references to other elements (clickable)
        const REF_KEYS = new Set(["microflow_calls", "nanoflow_calls", "page_links", "calls", "generalization"]);
        const isQn = (s) => typeof s === "string" && /^[A-Za-z0-9_]+\.[A-Za-z0-9_]+/.test(s);

        function refLink(qn) {
          const a = el("a", "ref", qn);
          a.addEventListener("click", () => window.__selectByQn(qn.split(/[\s(]/)[0]));
          return a;
        }

        function renderScalar(v) {
          if (typeof v === "string" && isQn(v) && DETAILS[v]) return refLink(v);
          const span = el("span");
          span.textContent = String(v);
          return span;
        }

        function renderArray(key, arr) {
          if (arr.length === 0) return el("p", "empty", "none");
          const objs = arr.filter((x) => x && typeof x === "object" && !Array.isArray(x));
          if (objs.length === arr.length) {
            // table with the union of keys
            const cols = [];
            arr.forEach((o) => Object.keys(o).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
            const table = el("table");
            const thead = el("thead"); const htr = el("tr");
            cols.forEach((c) => htr.appendChild(el("th", null, c)));
            thead.appendChild(htr); table.appendChild(thead);
            const tbody = el("tbody");
            arr.forEach((o) => {
              const tr = el("tr");
              cols.forEach((c) => {
                const td = el("td");
                const v = o[c];
                if (v == null) td.appendChild(el("span", "empty", "—"));
                else if (typeof v === "object") td.appendChild(el("code", "inline", JSON.stringify(v)));
                else td.appendChild(renderScalar(v));
                tr.appendChild(td);
              });
              tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            return table;
          }
          // list of scalars
          const ul = el("ul");
          ul.style.margin = "0"; ul.style.paddingLeft = "18px";
          arr.forEach((v) => {
            const li = el("li");
            li.appendChild(REF_KEYS.has(key) || isQn(v) ? renderScalar(v) : el("span", null, String(v)));
            ul.appendChild(li);
          });
          return ul;
        }

        function block(title, node) {
          const s = el("section", "block");
          s.appendChild(el("h3", null, title.replace(/_/g, " ")));
          const body = el("div", "body");
          body.appendChild(node);
          s.appendChild(body);
          return s;
        }

        function renderDetail(n) {
          const qn = n.qualifiedName;
          const d = DETAILS[qn] || {};
          detail.innerHTML = "";

          const h = el("h2", null, n.label || qn);
          detail.appendChild(h);
          const sub = el("div", "qn");
          sub.textContent = (n.type || "element") + "  ·  " + qn;
          if (d.parse_status) {
            const p = el("span", "pill " + (d.parse_status === "parsed" ? "ok" : "warn"), d.parse_status);
            sub.appendChild(p);
          }
          detail.appendChild(sub);

          // scalar summary (short string/number/bool fields) as a key/value grid
          const scalars = Object.entries(d).filter(([k, v]) =>
            k !== "parse_status" && (typeof v !== "object") && !(typeof v === "string" && v.length > 120));
          if (scalars.length) {
            const dl = el("dl", "kv");
            scalars.forEach(([k, v]) => {
              dl.appendChild(el("dt", null, k.replace(/_/g, " ")));
              const dd = el("dd");
              dd.appendChild(renderScalar(v));
              dl.appendChild(dd);
            });
            detail.appendChild(block("summary", dl));
          }

          // everything else, in a stable, page-friendly order
          const ORDER = ["parameters", "widget_types", "widgets", "data_sources", "attributes",
            "actions", "microflow_calls", "nanoflow_calls", "page_links", "view_roles",
            "access_rules", "execute_roles", "variables", "activities", "calls", "generalization"];
          const keys = Object.keys(d).filter((k) =>
            !scalars.some(([sk]) => sk === k) && k !== "parse_status" && k !== "mdl");
          keys.sort((a, b) => {
            const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
          });

          keys.forEach((k) => {
            const v = d[k];
            let node;
            if (Array.isArray(v)) node = renderArray(k, v);
            else if (v && typeof v === "object") {
              const dl = el("dl", "kv");
              Object.entries(v).forEach(([kk, vv]) => {
                dl.appendChild(el("dt", null, kk));
                const dd = el("dd");
                dd.appendChild(renderScalar(vv));
                dl.appendChild(dd);
              });
              node = dl;
            } else node = renderScalar(v);
            detail.appendChild(block(k, node));
          });

          if (d.mdl) detail.appendChild(block("MDL", el("pre", null, d.mdl)));

          if (!Object.keys(d).length) {
            detail.appendChild(el("p", "empty", "This node is a container; it has no element details."));
          }
        }
      })();
      </script>
      </body>
      </html>
    HTML
  end
end
