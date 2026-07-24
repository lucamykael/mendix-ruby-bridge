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

export interface EditableAttribute {
  name: string;
  type: string;
  required: boolean;
  length?: number | null;
  enumeration?: string;
  default?: unknown;
}

export interface EntityPlanResult {
  ok: boolean;
  blocked: boolean;
  operation: {
    action: "keep" | "create" | "modify" | "blocked";
    type: string;
    name: string;
    changes?: Record<string, unknown>;
    reason?: string;
  };
  mdl: string;
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

export function planEntity(
  qn: string,
  persistable: boolean,
  attributes: EditableAttribute[],
): Promise<Mocked<EntityPlanResult>> {
  return fetch(`${BASE}/entity-plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ qn, persistable, attributes }),
  }).then(async (response) => {
    const body = await response.json() as EntityPlanResult | { error?: string };
    if (response.ok) return { data: body as EntityPlanResult, mocked: false };
    return {
      data: entityPlanError(
        qn,
        ("error" in body && body.error) || `Backend rejected the plan (${response.status}).`,
      ),
      mocked: false,
    };
  }).catch(() => ({
    data: entityPlanError(qn, "Backend unavailable; the visual plan was not saved."),
    mocked: true,
  }));
}

function entityPlanError(qn: string, reason: string): EntityPlanResult {
  return {
    ok: false,
    blocked: true,
    operation: { action: "blocked", type: "entity", name: qn, reason },
    mdl: "",
  };
}

// ---- guarded Git workflow --------------------------------------------------
// Mutations require confirming Studio Pro is closed (it locks the .mpr). Unlike
// the marketplace/layout helpers these never fake success: a failed guard or a
// dirty tree must surface as a real error the panel can show.

export interface GitStatus {
  branch: string;
  clean: boolean;
  operation_in_progress: string | null;
  ready_to_switch: boolean;
  project?: string;
  project_tracked?: boolean;
}

async function gitRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/git${path}`, init);
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `Git request failed (${r.status}).`);
  return body as T;
}

function gitPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return gitRequest<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const git = {
  status: () => gitRequest<GitStatus>("/status"),
  branches: () => gitRequest<{ branches: string[]; current: string }>("/branches"),
  stashList: () => gitRequest<{ stash: string[] }>("/stash"),
  fetch: () => gitPost<GitStatus>("/fetch", {}),
  switch: (branch: string, studioClosed: boolean) =>
    gitPost<GitStatus>("/switch", { branch, studio_closed: studioClosed }),
  create: (branch: string, studioClosed: boolean) =>
    gitPost<GitStatus>("/create", { branch, studio_closed: studioClosed }),
  commit: (message: string, studioClosed: boolean) =>
    gitPost<GitStatus>("/commit", { message, studio_closed: studioClosed }),
  stashPush: (message: string, includeUntracked: boolean, studioClosed: boolean) =>
    gitPost<GitStatus & { output: string }>("/stash", {
      message: message || undefined,
      include_untracked: includeUntracked,
      studio_closed: studioClosed,
    }),
  stashApply: (reference: string, drop: boolean, studioClosed: boolean) =>
    gitPost<GitStatus>("/stash/apply", { reference, drop, studio_closed: studioClosed }),
  stashDrop: (reference: string) => gitPost<{ dropped: string }>("/stash/drop", { reference }),
};

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
