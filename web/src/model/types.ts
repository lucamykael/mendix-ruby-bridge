// Shapes of the imported Mendix inventory (produced by `mendix-ruby import`).

export interface TreeNode {
  label: string;
  type: string;
  qualifiedName?: string;
  children?: TreeNode[];
}

export interface ElementDetail {
  // common
  parse_status?: string;
  mdl?: string;
  folder?: string;
  // pages
  title?: string;
  layout?: string;
  parameters?: Array<Record<string, unknown>>;
  widgets?: Widget[];
  widget_types?: Record<string, number>;
  data_sources?: Array<Record<string, unknown>>;
  attributes?: Attribute[];
  actions?: Array<Record<string, unknown>>;
  microflow_calls?: string[];
  nanoflow_calls?: string[];
  page_links?: string[];
  view_roles?: string[];
  // entities
  kind?: string;
  persistable?: boolean;
  generalization?: string;
  access_rules?: Array<Record<string, unknown>>;
  // flows
  return_type?: string;
  variables?: Array<Record<string, unknown>>;
  activities?: Array<Record<string, unknown>>;
  calls?: string[];
  execute_roles?: string[];
  // associations
  from?: string;
  to?: string;
  association_type?: string;
  owner?: string;
  [key: string]: unknown;
}

export interface Widget {
  type: string;
  name?: string;
  declaration: string;
}

export interface Attribute {
  name: string;
  type?: string;
  required?: boolean;
  declaration?: string;
  default?: unknown;
}

export interface ProjectMeta {
  source_project?: string;
  imported_at?: string;
  element_count?: number;
  types?: Record<string, number>;
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: string;
  path: string;
}

export interface DependencyGraph {
  schema_version: number;
  nodes: number;
  edges: DependencyEdge[];
}

export interface NodePosition {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface BackendHealth {
  ok: boolean;
  version: string;
  element_count?: number;
  imported_at?: string;
  capabilities: Record<string, boolean>;
  app?: { running: boolean; log_length: number };
  auth?: { logged_in: boolean; username: string | null };
}

export interface Inventory {
  tree: TreeNode[];
  details: Record<string, ElementDetail>;
  meta: ProjectMeta;
  dependencies: DependencyGraph;
  layouts: Record<string, NodePosition[]>;
}
