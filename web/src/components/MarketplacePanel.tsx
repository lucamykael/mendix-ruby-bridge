import { useEffect, useState } from "react";
import { searchMarketplace, installMarketplaceItem, type MarketplaceItem } from "../model/api";

function ItemModal({ item, onClose }: { item: MarketplaceItem; onClose: () => void }) {
  const [studioClosed, setStudioClosed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [toast, setToast] = useState<string>();

  const install = async () => {
    setInstalling(true);
    const result = await installMarketplaceItem(item.id, item.latestVersion, studioClosed);
    setInstalling(false);
    setToast(result.message);
    if (result.ok) setTimeout(() => window.location.reload(), 1800);
    else setTimeout(() => setToast(undefined), 6000);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal mp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          {item.name}
          {item.latestVersion && <span className="ver"> v{item.latestVersion}</span>}
        </div>

        <div className="mp-modal-meta">
          {item.publisher && <span>{item.publisher}</span>}
          {item.category && <span>· {item.category}</span>}
          {item.rating && <span>· ★ {item.rating}</span>}
          {item.downloads && <span>· {(item.downloads / 1000).toFixed(0)}k downloads</span>}
        </div>

        {item.summary && <p className="mp-modal-summary">{item.summary}</p>}

        {item.url && (
          <a className="mp-modal-link" href={item.url} target="_blank" rel="noreferrer">
            View in Marketplace →
          </a>
        )}

        <label className="git-hint">
          <input type="checkbox" checked={studioClosed} onChange={(e) => setStudioClosed(e.target.checked)} />
          Studio Pro is closed
        </label>

        {toast && <div className={toast.startsWith("Error") || toast.includes("fail") ? "git-error" : "git-notice"}>{toast}</div>}

        <div className="modal-actions">
          <button className="editor-secondary" onClick={onClose}>Cancel</button>
          <button
            className="w-btn"
            disabled={!studioClosed || installing}
            onClick={() => void install()}
          >
            {installing ? "Installing…" : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MarketplacePanel() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [mocked, setMocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MarketplaceItem>();

  const run = async (query: string) => {
    setLoading(true);
    const { data, mocked } = await searchMarketplace(query);
    setItems(data);
    setMocked(mocked);
    setLoading(false);
  };

  useEffect(() => { void run(""); }, []);

  return (
    <div className="mp-panel">
      <form
        className="mp-search-row"
        onSubmit={(e) => { e.preventDefault(); void run(q); }}
      >
        <input
          type="search"
          placeholder="Search marketplace…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit">Go</button>
      </form>

      {mocked && (
        <span className="mock-badge mp-mock">offline sample</span>
      )}

      {loading ? (
        <p className="empty pad">Searching…</p>
      ) : (
        <div className="mp-list">
          {items.map((it) => (
            <div
              key={it.id}
              className="mp-row"
              onClick={() => setSelected(it)}
              title="Click for details and install"
            >
              <div className="mp-row-name">
                {it.name}
                {it.latestVersion && <span className="ver"> v{it.latestVersion}</span>}
              </div>
              <div className="mp-row-sub">
                {[it.publisher, it.category].filter(Boolean).join(" · ")}
              </div>
            </div>
          ))}
          {!items.length && <p className="empty pad">No results.</p>}
        </div>
      )}

      {selected && <ItemModal item={selected} onClose={() => setSelected(undefined)} />}
    </div>
  );
}
