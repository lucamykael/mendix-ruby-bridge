import { useEffect, useState } from "react";
import { searchMarketplace, installMarketplaceItem, type MarketplaceItem } from "../model/api";

export default function Marketplace() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [mocked, setMocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string>();

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
    const { data } = await installMarketplaceItem(it.id, it.latestVersion);
    setToast(data.message);
    setTimeout(() => setToast(undefined), 4000);
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
              <button className="w-btn" onClick={() => install(it)}>
                Install
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
