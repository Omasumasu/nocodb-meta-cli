import { requestJson } from "./http.js";
import type {
  ApiVersion,
  CliConfig,
  NormalizedBase,
  NormalizedField,
  NormalizedTable,
  NormalizedView,
  NormalizedWorkspace,
} from "./types.js";

const V2_VIEW_TYPE_NAMES: Record<string, string> = {
  "1": "form",
  "2": "gallery",
  "3": "grid",
  "4": "kanban",
  "5": "map",
  "6": "calendar",
};

export function resolveRequestPath(apiVersion: ApiVersion, requestPath: string): string {
  if (requestPath.startsWith("/api/")) {
    return requestPath;
  }

  const normalizedPath = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;

  return `/api/${apiVersion}${normalizedPath}`;
}

function normalizeCollection(payload: any): any[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload) {
    return [];
  }

  for (const key of [
    "list",
    "data",
    "bases",
    "tables",
    "views",
    "fields",
    "columns",
    "workspaces",
  ]) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }

  return [payload];
}

function normalizeField(field: Record<string, any> = {}): NormalizedField {
  return {
    id: field.id,
    title: field.title,
    type: field.type ?? field.uidt,
    primary: Boolean(field.primary ?? field.pv ?? field.pk),
    system: Boolean(field.system),
    raw: field,
  };
}

function normalizeView(view: Record<string, any> = {}): NormalizedView {
  return {
    id: view.id,
    title: view.title,
    type: String(
      view.view_type ?? V2_VIEW_TYPE_NAMES[String(view.type)] ?? view.type ?? "grid",
    ).toLowerCase(),
    raw: {
      ...view,
      type: V2_VIEW_TYPE_NAMES[String(view.type)] ?? view.type ?? view.view_type,
    },
  };
}

function normalizeTable(table: Record<string, any> = {}): NormalizedTable {
  const fields = Array.isArray(table.fields)
    ? table.fields
    : Array.isArray(table.columns)
      ? table.columns
      : Object.values(table.columnsById ?? {});

  return {
    id: table.id,
    title: table.title,
    description: table.description,
    baseId: table.base_id ?? table.baseId,
    fields: fields.map(normalizeField),
    views: normalizeCollection(table.views).map(normalizeView),
    raw: table,
  };
}

function normalizeWorkspace(workspace: Record<string, any> = {}): NormalizedWorkspace {
  return {
    id: workspace.id,
    title: workspace.title,
    raw: workspace,
  };
}

function normalizeBase(base: Record<string, any> = {}): NormalizedBase {
  return {
    id: base.id,
    title: base.title,
    workspaceId: base.workspace_id ?? base.fk_workspace_id,
    raw: base,
  };
}

export function createNocoClient(config: CliConfig) {
  const { apiVersion } = config;

  async function request(
    method: string,
    requestPath: string,
    requestOptions: {
      query?: Record<string, unknown>;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<any> {
    return requestJson(config, {
      method,
      path: resolveRequestPath(apiVersion, requestPath),
      query: requestOptions.query,
      body: requestOptions.body,
      headers: requestOptions.headers,
    });
  }

  return {
    apiVersion,
    request,

    async listWorkspaces(): Promise<NormalizedWorkspace[]> {
      return normalizeCollection(await request("GET", "/meta/workspaces")).map(normalizeWorkspace);
    },

    async createWorkspace(payload: Record<string, unknown>): Promise<NormalizedWorkspace> {
      return normalizeWorkspace(await request("POST", "/meta/workspaces", { body: payload }));
    },

    async listBases(workspaceId: string | null): Promise<NormalizedBase[]> {
      const requestPath =
        apiVersion === "v2"
          ? workspaceId
            ? `/meta/workspaces/${workspaceId}/bases`
            : "/meta/bases/"
          : `/meta/workspaces/${workspaceId}/bases`;

      return normalizeCollection(await request("GET", requestPath)).map(normalizeBase);
    },

    async createBase(
      workspaceId: string | null,
      payload: Record<string, unknown>,
    ): Promise<NormalizedBase> {
      const requestPath =
        apiVersion === "v2"
          ? workspaceId
            ? `/meta/workspaces/${workspaceId}/bases`
            : "/meta/bases/"
          : `/meta/workspaces/${workspaceId}/bases`;

      return normalizeBase(await request("POST", requestPath, { body: payload }));
    },

    async listTables(baseId: string): Promise<NormalizedTable[]> {
      return normalizeCollection(await request("GET", `/meta/bases/${baseId}/tables`)).map(
        normalizeTable,
      );
    },

    async createTable(baseId: string, payload: Record<string, unknown>): Promise<NormalizedTable> {
      return normalizeTable(
        await request("POST", `/meta/bases/${baseId}/tables`, { body: payload }),
      );
    },

    async getTable(baseId: string, tableId: string): Promise<NormalizedTable> {
      const requestPath =
        apiVersion === "v2" ? `/meta/tables/${tableId}` : `/meta/bases/${baseId}/tables/${tableId}`;

      return normalizeTable(await request("GET", requestPath));
    },

    async createField(
      baseId: string,
      tableId: string,
      payload: Record<string, unknown>,
    ): Promise<NormalizedField | null> {
      const requestPath =
        apiVersion === "v2"
          ? `/meta/tables/${tableId}/columns`
          : `/meta/bases/${baseId}/tables/${tableId}/fields`;

      const response = await request("POST", requestPath, { body: payload });
      return response ? normalizeField(response) : null;
    },

    async listViews(baseId: string, tableId: string): Promise<NormalizedView[]> {
      const requestPath =
        apiVersion === "v2"
          ? `/meta/tables/${tableId}/views`
          : `/meta/bases/${baseId}/tables/${tableId}/views`;

      return normalizeCollection(await request("GET", requestPath)).map(normalizeView);
    },

    async createView(
      baseId: string,
      tableId: string,
      payload: Record<string, unknown>,
    ): Promise<NormalizedView> {
      const requestPath =
        apiVersion === "v2"
          ? `/meta/tables/${tableId}/${payload.type === 1 ? "forms" : payload.type === 2 ? "galleries" : payload.type === 3 ? "grids" : payload.type === 4 ? "kanbans" : "maps"}`
          : `/meta/bases/${baseId}/tables/${tableId}/views`;

      return normalizeView(await request("POST", requestPath, { body: payload }));
    },
  };
}
