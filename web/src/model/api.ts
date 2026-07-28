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

export interface MarketplaceSearchResult {
  items: MarketplaceItem[];
  source: "live" | "offline";
  needsLogin: boolean;
  reachable: boolean;
}

// Searches the official Mendix marketplace via the backend (mxcli). Live
// results require a Mendix login; otherwise the backend returns its offline
// catalog flagged as such. `refresh` bypasses mxcli's local catalog cache.
export async function searchMarketplace(
  q: string,
  limit = 20,
  refresh = false,
): Promise<MarketplaceSearchResult> {
  const query = encodeURIComponent(q);
  try {
    const r = await fetch(`${BASE}/marketplace/search?q=${query}&limit=${limit}${refresh ? "&refresh=1" : ""}`);
    if (!r.ok) throw new Error(String(r.status));
    const body = (await r.json()) as
      | MarketplaceItem[]
      | { items?: MarketplaceItem[]; source?: "live" | "offline"; needs_login?: boolean };
    if (Array.isArray(body)) {
      return { items: body, source: "live", needsLogin: false, reachable: true };
    }
    return {
      items: body.items ?? [],
      source: body.source ?? "live",
      needsLogin: body.needs_login ?? false,
      reachable: true,
    };
  } catch {
    return { items: mockSearch(q, limit), source: "offline", needsLogin: false, reachable: false };
  }
}

/** Guarded install: requires confirming Studio Pro is closed; never fakes success. */
export async function installMarketplaceItem(
  id: string,
  version: string | undefined,
  studioClosed: boolean,
): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await fetch(`${BASE}/marketplace/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, version, studio_closed: studioClosed }),
    });
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
    return { ok: body.ok === true, message: body.message ?? body.error ?? `Install failed (${r.status}).` };
  } catch (e) {
    return { ok: false, message: String(e instanceof Error ? e.message : e) };
  }
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

// ---- page builder ----------------------------------------------------------

export interface SavePageResult {
  ok: boolean;
  mdl?: string;
  message: string;
}

/** Validate + persist a built page as a draft. Surfaces the backend message. */
export async function savePage(qn: string, content: string): Promise<SavePageResult> {
  try {
    const r = await fetch(`${BASE}/page`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qn, content }),
    });
    const body = (await r.json().catch(() => ({}))) as Partial<SavePageResult> & { error?: string };
    if (!r.ok && body.ok === undefined) throw new Error(body.error ?? `Save failed (${r.status}).`);
    return body as SavePageResult;
  } catch (e) {
    return { ok: false, message: String(e instanceof Error ? e.message : e) };
  }
}

export interface MdlResult {
  ok: boolean;
  applied: boolean;
  needsStudioClosed?: boolean;
  message: string;
}

/**
 * Validate (and optionally apply) an arbitrary MDL script against the project.
 * `apply: false` only runs `mxcli check`; `apply: true` runs `mxcli exec` and
 * requires Studio Pro to be closed. Powers live editing from the AI chat.
 */
export async function runMdl(mdl: string, apply: boolean, studioClosed = false): Promise<MdlResult> {
  try {
    const r = await fetch(`${BASE}/mdl`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mdl, apply, studio_closed: studioClosed }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      ok?: boolean; applied?: boolean; needs_studio_closed?: boolean; message?: string; error?: string;
    };
    return {
      ok: body.ok === true,
      applied: body.applied === true,
      needsStudioClosed: body.needs_studio_closed,
      message: body.message ?? body.error ?? `Request failed (${r.status}).`,
    };
  } catch (e) {
    return { ok: false, applied: false, message: String(e instanceof Error ? e.message : e) };
  }
}

/** Validate + persist an in-place ALTER PAGE draft (surgical edits). */
export async function savePageAlter(qn: string, mdl: string): Promise<SavePageResult> {
  try {
    const r = await fetch(`${BASE}/page`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qn, mode: "alter", mdl }),
    });
    const body = (await r.json().catch(() => ({}))) as Partial<SavePageResult> & { error?: string };
    if (!r.ok && body.ok === undefined) throw new Error(body.error ?? `Save failed (${r.status}).`);
    return body as SavePageResult;
  } catch (e) {
    return { ok: false, message: String(e instanceof Error ? e.message : e) };
  }
}

/** Validate + persist a rebuilt flow body as a draft (same contract as savePage). */
export async function saveFlow(qn: string, body: string): Promise<SavePageResult> {
  try {
    const r = await fetch(`${BASE}/flow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qn, body }),
    });
    const parsed = (await r.json().catch(() => ({}))) as Partial<SavePageResult> & { error?: string };
    if (!r.ok && parsed.ok === undefined) throw new Error(parsed.error ?? `Save failed (${r.status}).`);
    return parsed as SavePageResult;
  } catch (e) {
    return { ok: false, message: String(e instanceof Error ? e.message : e) };
  }
}

/** Apply a validated draft to the source .mpr via the guarded workflow. */
export async function applyDraft(
  qn: string,
  type: "page" | "flow",
  studioClosed: boolean,
): Promise<SavePageResult> {
  try {
    const r = await fetch(`${BASE}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qn, type, studio_closed: studioClosed }),
    });
    const parsed = (await r.json().catch(() => ({}))) as Partial<SavePageResult> & { error?: string };
    if (!r.ok && parsed.ok === undefined) throw new Error(parsed.error ?? `Apply failed (${r.status}).`);
    return parsed as SavePageResult;
  } catch (e) {
    return { ok: false, message: String(e instanceof Error ? e.message : e) };
  }
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

export interface GitRef {
  name: string;
  type: "head" | "local" | "remote" | "tag" | "detached";
}

export interface GitCommit {
  sha: string;
  short_sha: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  refs: GitRef[];
  parents: string[];
}

export interface GitFileStatus {
  path: string;
  xy: string;
  index_status: string;
  worktree_status: string;
  renamed_from?: string;
}

export interface GitWorktree {
  path: string;
  sha: string;
  branch?: string;
  detached?: boolean;
  prunable?: boolean;
  locked?: boolean;
}

export const git = {
  status: () => gitRequest<GitStatus>("/status"),
  branches: () => gitRequest<{ branches: string[]; current: string; remotes: string[] }>("/branches"),
  tags: () => gitRequest<{ tags: string[] }>("/tags"),
  worktrees: () => gitRequest<{ worktrees: GitWorktree[]; root: string }>("/worktrees"),
  stashList: () => gitRequest<{ stash: string[] }>("/stash"),
  fetch: () => gitPost<GitStatus>("/fetch", {}),
  switch: (branch: string, studioClosed: boolean) =>
    gitPost<GitStatus>("/switch", { branch, studio_closed: studioClosed }),
  create: (branch: string, studioClosed: boolean, startPoint?: string, carryChanges = false) =>
    gitPost<GitStatus & { carried_changes: boolean; stashed_changes: boolean }>("/create", {
      branch,
      studio_closed: studioClosed,
      start_point: startPoint,
      carry_changes: carryChanges,
    }),
  command: (command: string, studioClosed: boolean) =>
    gitPost<GitStatus & { ok: boolean; command: string; output: string; exit_code: number }>(
      "/command",
      { command, studio_closed: studioClosed },
    ),
  commit: (message: string, studioClosed: boolean) =>
    gitPost<GitStatus>("/commit", { message, studio_closed: studioClosed }),
  commitStaged: (message: string, studioClosed: boolean) =>
    gitPost<GitStatus>("/commit-staged", { message, studio_closed: studioClosed }),
  stashPush: (message: string, includeUntracked: boolean, studioClosed: boolean) =>
    gitPost<GitStatus & { output: string }>("/stash", {
      message: message || undefined,
      include_untracked: includeUntracked,
      studio_closed: studioClosed,
    }),
  stashApply: (reference: string, drop: boolean, studioClosed: boolean) =>
    gitPost<GitStatus>("/stash/apply", { reference, drop, studio_closed: studioClosed }),
  stashDrop: (reference: string) => gitPost<{ dropped: string }>("/stash/drop", { reference }),
  log: (max = 200) => gitRequest<{ commits: GitCommit[] }>(`/log?max=${max}`),
  fileStatus: () => gitRequest<{ files: GitFileStatus[] }>("/file-status"),
  stage: (path: string) => gitPost<{ ok: boolean }>("/stage", { path }),
  unstage: (path: string) => gitPost<{ ok: boolean }>("/unstage", { path }),
  discard: (path: string) => gitPost<{ ok: boolean }>("/discard", { path }),
  push: () => gitPost<{ ok: boolean; output: string }>("/push", {}),
  addRemote: (name: string, url: string) =>
    gitPost<{ ok: boolean; name: string; url: string }>("/remote", { name, url }),
  pull: (studioClosed: boolean) => gitPost<GitStatus & { ok: boolean; output: string }>("/pull", { studio_closed: studioClosed }),
  cherryPick: (sha: string, studioClosed: boolean) =>
    gitPost<GitStatus & { ok: boolean }>("/cherry-pick", { sha, studio_closed: studioClosed }),
  revert: (sha: string, studioClosed: boolean) =>
    gitPost<GitStatus & { ok: boolean }>("/revert", { sha, studio_closed: studioClosed }),
  reset: (sha: string, mode: "soft" | "mixed" | "hard", studioClosed: boolean) =>
    gitPost<GitStatus & { ok: boolean }>("/reset", { sha, mode, studio_closed: studioClosed }),
  createTag: (name: string, sha?: string, message?: string) =>
    gitPost<{ ok: boolean }>("/tag", { name, sha, message }),
  deleteTag: (name: string) => gitPost<{ ok: boolean }>("/delete-tag", { name }),
  deleteBranch: (name: string, force = false) =>
    gitPost<{ ok: boolean }>("/delete-branch", { name, force }),
  merge: (branch: string, studioClosed: boolean) =>
    gitPost<GitStatus>("/merge", { branch, studio_closed: studioClosed }),
  rebase: (branch: string, studioClosed: boolean) =>
    gitPost<GitStatus>("/rebase", { branch, studio_closed: studioClosed }),
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
