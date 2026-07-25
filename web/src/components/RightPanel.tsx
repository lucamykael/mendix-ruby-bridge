import { useState } from "react";
import Toolbox from "./Toolbox";
import MarketplacePanel from "./MarketplacePanel";
import AIChat from "./AIChat";
import type { Selection } from "./Tree";
import type { ElementDetail } from "../model/types";

type RightTab = "toolbox" | "marketplace" | "properties" | "chat";

function PropertiesPanel({ selection, detail }: { selection?: Selection; detail?: ElementDetail }) {
  if (!selection) return <p className="rp-empty">Select an element to view its properties.</p>;
  if (!detail) return <p className="rp-empty">No property data for {selection.qn}.</p>;

  return (
    <div className="rp-props">
      <div className="rp-props-head">
        <span className="rp-props-type">{selection.type}</span>
        <span className="rp-props-label">{selection.label}</span>
      </div>
      <div className="rp-props-qn">{selection.qn}</div>

      {detail.parse_status && (
        <div className="rp-prop-row">
          <span className="rp-prop-key">Status</span>
          <span className={`rp-prop-val pill ${detail.parse_status === "parsed" ? "ok" : "warn"}`}>
            {detail.parse_status}
          </span>
        </div>
      )}

      {detail.persistable !== undefined && (
        <div className="rp-prop-row">
          <span className="rp-prop-key">Persistable</span>
          <span className="rp-prop-val">{detail.persistable ? "Yes" : "No"}</span>
        </div>
      )}

      {detail.title && (
        <div className="rp-prop-row">
          <span className="rp-prop-key">Title</span>
          <span className="rp-prop-val">{detail.title}</span>
        </div>
      )}

      {detail.layout && (
        <div className="rp-prop-row">
          <span className="rp-prop-key">Layout</span>
          <span className="rp-prop-val rp-mono">{detail.layout}</span>
        </div>
      )}

      {detail.return_type && (
        <div className="rp-prop-row">
          <span className="rp-prop-key">Returns</span>
          <span className="rp-prop-val rp-mono">{detail.return_type}</span>
        </div>
      )}

      {detail.folder && (
        <div className="rp-prop-row">
          <span className="rp-prop-key">Folder</span>
          <span className="rp-prop-val">{detail.folder}</span>
        </div>
      )}

      {detail.generalization && (
        <div className="rp-prop-row">
          <span className="rp-prop-key">Generalizes</span>
          <span className="rp-prop-val rp-mono">{detail.generalization}</span>
        </div>
      )}

      {Array.isArray(detail.attributes) && detail.attributes.length > 0 && (
        <div className="rp-prop-section">
          <div className="rp-prop-section-title">Attributes ({detail.attributes.length})</div>
          {detail.attributes.map((a, i) => (
            <div key={i} className="rp-attr-row">
              <span className="rp-attr-name">{a.name}</span>
              <span className="rp-attr-type">{a.type ?? "?"}</span>
              {a.required && <span className="rp-attr-req">*</span>}
            </div>
          ))}
        </div>
      )}

      {Array.isArray(detail.parameters) && detail.parameters.length > 0 && (
        <div className="rp-prop-section">
          <div className="rp-prop-section-title">Parameters ({detail.parameters.length})</div>
          {detail.parameters.map((p, i) => (
            <div key={i} className="rp-attr-row">
              <span className="rp-attr-name">{String((p as Record<string, unknown>).name ?? i)}</span>
              <span className="rp-attr-type">{String((p as Record<string, unknown>).type ?? "?")}</span>
            </div>
          ))}
        </div>
      )}

      {detail.from && detail.to && (
        <>
          <div className="rp-prop-row">
            <span className="rp-prop-key">From</span>
            <span className="rp-prop-val rp-mono">{detail.from}</span>
          </div>
          <div className="rp-prop-row">
            <span className="rp-prop-key">To</span>
            <span className="rp-prop-val rp-mono">{detail.to}</span>
          </div>
          {detail.association_type && (
            <div className="rp-prop-row">
              <span className="rp-prop-key">Type</span>
              <span className="rp-prop-val">{detail.association_type}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const TAB_LABELS: Record<RightTab, string> = {
  toolbox: "Toolbox",
  marketplace: "Marketplace",
  properties: "Properties",
  chat: "AI Chat",
};

export default function RightPanel({
  context,
  selection,
  detail,
}: {
  context?: string;
  selection?: Selection;
  detail?: ElementDetail;
}) {
  const [tab, setTab] = useState<RightTab>("toolbox");

  return (
    <div className="right-panel">
      <div className="rp-tabs">
        {(Object.keys(TAB_LABELS) as RightTab[]).map((t) => (
          <button
            key={t}
            className={tab === t ? "on" : ""}
            onClick={() => setTab(t)}
            title={TAB_LABELS[t]}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="rp-body">
        {tab === "toolbox" && <Toolbox context={context} />}
        {tab === "marketplace" && <MarketplacePanel />}
        {tab === "properties" && <PropertiesPanel selection={selection} detail={detail} />}
        {tab === "chat" && <AIChat />}
      </div>
    </div>
  );
}
