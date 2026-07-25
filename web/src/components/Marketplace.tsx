import { useEffect, useState } from "react";
import { searchMarketplace, installMarketplaceItem, type MarketplaceItem } from "../model/api";

export default function Marketplace() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [mocked, setMocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string>();
  const [studioClosed, setStudioClosed] = useState(false);
  const [installing, setInstalling] = useState<string>();

  const run = async (query: string) => {
    setLoading(true);
    const { data, mocked } = await searchMarketplace(query);
    setItems(data);
    setMocked(mocked);
    setLoading(false);
  };

  useEffect(() => {
    run("");
  }, []);

  const install = async (it: MarketplaceItem) => {
    setInstalling(it.id);
    const result = await installMarketplaceItem(it.id, it.latestVersion, studioClosed);
    setInstalling(undefined);
    setToast(result.message);
    if (result.ok) {
      // Reload so the imported module shows up in the App Explorer.
      setTimeout(() => window.location.reload(), 1800);
    } else {
      setTimeout(() => setToast(undefined), 6000);
    }
  };

  return (
    <div className="market">
      <div className="market-head">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(q);
          }}
        >
          <input
            type="search"
            placeholder="Search the Mendix marketplace…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit">Search</button>
        </form>
        <label className="git-hint" title="Installing imports the module into the .mpr, which Studio Pro locks while open">
          <input type="checkbox" checked={studioClosed} onChange={(e) => setStudioClosed(e.target.checked)} />
          Studio Pro is closed
        </label>
        {mocked && (
          <span className="mock-badge" title="Backend not connected — showing offline sample data">
            offline sample
          </span>
        )}
      </div>

      {loading ? (
        <p className="empty pad">Searching…</p>
      ) : (
        <div className="market-list">
          {items.map((it) => (
            <div className="market-card" key={it.id}>
              <div className="market-card-main">
                <div className="market-title">
                  {it.name}
                  {it.latestVersion && <span className="ver">v{it.latestVersion}</span>}
                </div>
                <div className="market-sub">
                  {it.publisher} {it.category ? `· ${it.category}` : ""}
                  {it.rating ? ` · ★ ${it.rating}` : ""}
                  {it.downloads ? ` · ${(it.downloads / 1000).toFixed(0)}k downloads` : ""}
                </div>
                {it.summary && <div className="market-summary">{it.summary}</div>}
              </div>
              <button className="w-btn" disabled={!studioClosed || installing === it.id} onClick={() => install(it)}>
                {installing === it.id ? "Installing…" : "Install"}
              </button>
            </div>
          ))}
          {!items.length && <p className="empty pad">No results.</p>}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
