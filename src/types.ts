export type ApiVersion = "v2" | "v3";

export type FlagValue = string | boolean | Array<string | boolean>;
export type FlagMap = Record<string, FlagValue>;

export interface ApiOverrides {
  common?: Record<string, unknown>;
  v2?: Record<string, unknown>;
  v3?: Record<string, unknown>;
}

export interface WorkspaceSpec {
  id?: string;
  title?: string;
  description?: string;
  orgId?: string;
  create?: boolean;
  api: ApiOverrides;
}

export interface BaseSpec {
  id?: string;
  title?: string;
  description?: string;
  workspaceId?: string;
  create?: boolean;
  meta: Record<string, unknown>;
  api: ApiOverrides;
}

export interface FieldSpec {
  title?: string;
  type?: string;
  description?: string;
  defaultValue?: unknown;
  required?: boolean;
  unique?: boolean;
  primary?: boolean;
  options: Record<string, any>;
  api: ApiOverrides;
}

export interface ViewSpec {
  title?: string;
  type: string;
  options: Record<string, any>;
  filters: Record<string, unknown> | Array<unknown>;
  sorts: Array<Record<string, any>>;
  fields: Array<Record<string, unknown>>;
  rowColoring?: Record<string, unknown>;
  api: ApiOverrides;
}

export interface TableSpec {
  title?: string;
  description?: string;
  create?: boolean;
  fields: FieldSpec[];
  views: ViewSpec[];
  api: ApiOverrides;
}

export interface Manifest {
  workspace: WorkspaceSpec | null;
  base: BaseSpec | null;
  tables: TableSpec[];
}

export interface CliConfig {
  apiVersion: ApiVersion;
  baseUrl: string | null;
  token: string | null;
  workspaceId: string | null;
  baseId: string | null;
  json: boolean;
  verbose: boolean;
  configPath: string | null;
}

export interface NormalizedField {
  id?: string;
  title?: string;
  type?: string;
  primary: boolean;
  system: boolean;
  raw: Record<string, unknown>;
}

export interface NormalizedView {
  id?: string;
  title?: string;
  type?: string;
  raw: Record<string, unknown>;
}

export interface NormalizedTable {
  id?: string;
  title?: string;
  description?: string;
  baseId?: string;
  fields: NormalizedField[];
  views: NormalizedView[];
  raw: Record<string, unknown>;
}

export interface NormalizedWorkspace {
  id?: string;
  title?: string;
  raw: Record<string, unknown>;
}

export interface NormalizedBase {
  id?: string;
  title?: string;
  workspaceId?: string;
  raw: Record<string, unknown>;
}

export interface ApplySummaryEntry {
  kind: "workspace" | "base" | "table" | "field" | "view";
  action: "selected" | "reused" | "created" | "planned";
  title?: string;
  id?: string;
  tableTitle?: string;
}

export interface ResourceCounts {
  tables: number;
  fields: number;
  views: number;
}

export interface ApplySummary {
  mode: "apply" | "plan";
  apiVersion: ApiVersion;
  entries: ApplySummaryEntry[];
  warnings: string[];
  resourceCounts?: ResourceCounts;
}
