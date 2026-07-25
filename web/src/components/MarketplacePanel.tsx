import { useEffect, useState } from "react";
import { searchMarketplace, installMarketplaceItem, type MarketplaceItem } from "../model/api";

function ItemModal({ item, onClose, onLogin }: { item: MarketplaceItem; onClose: () => void; onLogin?: () => void }) {
  const [studioClosed, setStudioClosed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [toast, setToast] = useState<string>();
  const [needsLogin, setNeedsLogin] = useState(false);

  const install = async () => {
    setInstalling(true);
    setNeedsLogin(false);
    const result = await installMarketplaceItem(item.id, item.latestVersion, studioClosed);
    setInstalling(false);
    setToast(result.message);
    if (result.ok) setTimeout(() => window.location.reload(), 1800);
    else if (/log in/i.test(result.message)) setNeedsLogin(true);
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

        {toast && <div className={/fail|error|log in/i.test(toast) ? "git-error" : "git-notice"}>{toast}</div>}

        <div className="modal-actions">
          <button className="editor-secondary" onClick={onClose}>Cancel</button>
          {needsLogin && onLogin ? (
            <button className="w-btn" onClick={onLogin}>👤 Log in</button>
          ) : (
            <button className="w-btn" disabled={!studioClosed || installing} onClick={() => void install()}>
              {installing ? "Installing…" : "Install"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MarketplacePanel({ onLogin, loggedIn }: { onLogin?: () => void; loggedIn?: boolean }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [source, setSource] = useState<"live" | "offline">("offline");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [reachable, setReachable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MarketplaceItem>();

  const run = async (query: string, refresh = false) => {
    setLoading(true);
    const res = await searchMarketplace(query, 20, refresh);
    setItems(res.items);
    setSource(res.source);
    setNeedsLogin(res.needsLogin);
    setReachable(res.reachable);
    setLoading(false);
  };

  // Re-run once the user logs in, so results switch to live automatically.
  useEffect(() => { void run(q); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [loggedIn]);

  return (
    <div className="mp-panel">
      <form
        className="mp-search-row"
        onSubmit={(e) => { e.preventDefault(); void run(q, true); }}
      >
        <input
          type="search"
          placeholder="Search the Mendix marketplace…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit">Go</button>
      </form>

      {source === "live" ? (
        <div className="mp-source mp-source-live">● Live Mendix marketplace</div>
      ) : (
        <div className="mp-source mp-source-offline">
          {reachable ? "Offline catalog" : "Backend offline — sample data"}
          {needsLogin && onLogin && (
            <>
              {" · "}
              <button className="mp-login-link" onClick={onLogin}>Log in for live search</button>
            </>
          )}
        </div>
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

      {selected && <ItemModal item={selected} onClose={() => setSelected(undefined)} onLogin={onLogin} />}
    </div>
  );
}
