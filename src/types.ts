export type ApiVersion = "v2" | "v3";
export type ConfigSource = "env" | "managed" | "none";
export type SecretStoreKind = "macos-keychain" | "linux-secret-service" | "unsupported";

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
  profileName: string | null;
  configHome: string | null;
  projectContextPath: string | null;
  managed: boolean;
  configSource: ConfigSource;
  secretStoreKind: SecretStoreKind | null;
  json: boolean;
  verbose: boolean;
  configPath: string | null;
}

export interface ProfileRecord {
  name: string;
  baseUrl: string;
  apiVersion: ApiVersion;
  workspaceId: string | null;
  baseId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProfilesFile {
  version: 1;
  defaultProfile: string | null;
  profiles: Record<string, ProfileRecord>;
}

export interface ProjectContext {
  version: 1;
  profile: string | null;
  workspaceId: string | null;
  baseId: string | null;
  updatedAt: string;
}

export interface SecretStore {
  kind: SecretStoreKind;
  isAvailable(): Promise<{ ok: boolean; reason?: string }>;
  getToken(profileName: string): Promise<string | null>;
  setToken(profileName: string, token: string): Promise<void>;
  deleteToken(profileName: string): Promise<void>;
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

export type DiffAction = "add" | "modify" | "delete" | "type_change";

export interface DiffChange {
  from: unknown;
  to: unknown;
}

export interface DiffEntry {
  kind: "table" | "field";
  action: DiffAction;
  title: string;
  tableTitle?: string;
  type?: string;
  blocked: boolean;
  reason?: string;
  changes?: Record<string, DiffChange>;
  fields?: DiffEntry[];
}

export interface DiffPlan {
  entries: DiffEntry[];
  summary: {
    tables: { add: number; delete: number };
    fields: { add: number; modify: number; delete: number; blocked: number };
  };
}

export interface DiffOptions {
  baseId: string;
  workspaceId: string | null;
  execute: boolean;
  allowDropTable: boolean;
  forceTypeChange: boolean;
  json: boolean;
}
