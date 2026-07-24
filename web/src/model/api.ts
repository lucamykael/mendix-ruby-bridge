// Typed client for the Ruby backend that wraps the bridge + mxcli. Marketplace
// reads retain an offline fixture; mutations never pretend to have succeeded.
//
// Backend contract:
//   GET  /api/marketplace/search?q=&limit=   -> MarketplaceItem[]   (mxcli marketplace search --json)
//   GET  /api/marketplace/item/:id           -> MarketplaceItem     (mxcli marketplace info)
//   POST /api/marketplace/install {id,version}-> 403 (guarded CLI workflow only)
//   POST /api/layout {qn, positions}         -> { ok, mdlPreview } (viewer sidecar)

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export interface MarketplaceItem {
  id: string;
  name: string;
  publisher?: string;
  latestVersion?: string;
  category?: string;
  rating?: number;
  downloads?: number;
  summary?: string;
  url?: string;
}

export interface NodePosition {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface LayoutResult {
  ok: boolean;
  persisted?: boolean;
  message: string;
  mdlPreview: string;
}

export interface Mocked<T> {
  data: T;
  mocked: boolean;
}

async function getJSON<T>(path: string, fallback: () => T): Promise<Mocked<T>> {
  try {
    const r = await fetch(`${BASE}${path}`);
    if (!r.ok) throw new Error(String(r.status));
    return { data: (await r.json()) as T, mocked: false };
  } catch {
    return { data: fallback(), mocked: true };
  }
}

async function postJSON<T>(path: string, body: unknown, fallback: () => T): Promise<Mocked<T>> {
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(String(r.status));
    return { data: (await r.json()) as T, mocked: false };
  } catch {
    return { data: fallback(), mocked: true };
  }
}

export function searchMarketplace(q: string, limit = 20): Promise<Mocked<MarketplaceItem[]>> {
  const query = encodeURIComponent(q);
  return getJSON(`/marketplace/search?q=${query}&limit=${limit}`, () => mockSearch(q, limit));
}

export function installMarketplaceItem(id: string, version?: string): Promise<Mocked<{ ok: boolean; message: string }>> {
  return postJSON(`/marketplace/install`, { id, version }, () => ({
    ok: false,
    message: `Backend unavailable or installation disabled for ${id}${version ? "@" + version : ""}.`,
  }));
}

export function saveLayout(qn: string, positions: NodePosition[]): Promise<Mocked<LayoutResult>> {
  return postJSON(`/layout`, { qn, positions }, () => ({
    ok: false,
    message: "Backend unavailable; layout was not saved.",
    mdlPreview: positions.map((p) => `@position(${Math.round(p.x)}, ${Math.round(p.y)})  ${p.label}`).join("\n"),
  }));
}

// ---- offline fixture -------------------------------------------------------
const FIXTURE: MarketplaceItem[] = [
  { id: "1866", name: "Community Commons", publisher: "Mendix", latestVersion: "10.0.4", category: "Utility", rating: 4.6, downloads: 240000, summary: "Widely-used helper functions (Java actions) for strings, dates, files and more." },
  { id: "120", name: "Excel Importer", publisher: "Mendix", latestVersion: "11.1.0", category: "Import/Export", rating: 4.3, downloads: 180000, summary: "Import data from Excel/CSV templates into your domain model." },
  { id: "45", name: "Feedback", publisher: "Mendix", latestVersion: "4.0.2", category: "Collaboration", rating: 4.1, downloads: 95000, summary: "In-app feedback widget that posts to a feedback backend." },
  { id: "215", name: "Database Replication", publisher: "Mendix", latestVersion: "7.2.1", category: "Integration", rating: 4.0, downloads: 60000, summary: "Sync an external database into Mendix entities." },
  { id: "107293", name: "Data Widgets", publisher: "Mendix", latestVersion: "3.5.0", category: "Widgets", rating: 4.5, downloads: 320000, summary: "Datagrid 2, dropdown filters and other data-bound widgets." },
];

function mockSearch(q: string, limit: number): MarketplaceItem[] {
  const ql = q.trim().toLowerCase();
  const hits = ql
    ? FIXTURE.filter((i) => (i.name + " " + i.category + " " + i.summary).toLowerCase().includes(ql))
    : FIXTURE;
  return hits.slice(0, limit);
}
