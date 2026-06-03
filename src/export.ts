import { CliError } from "./errors.js";
import type {
  FieldSpec,
  Manifest,
  NormalizedField,
  NormalizedTable,
  NormalizedView,
  TableSpec,
  ViewSpec,
} from "./types.js";
import { createNocoClient } from "./nocodb-client.js";
import { stripUndefined } from "./utils.js";

export interface ExportOptions {
  baseId: string;
  workspaceId: string | null;
  tables: string[] | null;
  includeSystem: boolean;
}

type NocoClient = ReturnType<typeof createNocoClient>;

const RELATION_TYPES: Record<string, string> = {
  hm: "hm",
  mm: "mm",
  oo: "oo",
  bt: "bt",
};

export function fieldToSpec(
  field: NormalizedField,
  tableIdToTitle: Map<string, string>,
  fieldIdToTitle: Map<string, string>,
): FieldSpec | null {
  const raw = field.raw;
  const type = field.type;

  if (!type) {
    return null;
  }

  const spec: FieldSpec = {
    title: field.title,
    type,
    options: {},
    api: {},
  };

  if (raw.description) {
    spec.description = raw.description as string;
  }

  if (raw.cdf !== undefined && raw.cdf !== null) {
    spec.defaultValue = raw.cdf;
  } else if (raw.default_value !== undefined && raw.default_value !== null) {
    spec.defaultValue = raw.default_value;
  }

  if (raw.rqd) {
    spec.required = true;
  }

  if (field.primary) {
    spec.primary = true;
  }

  if (raw.un) {
    spec.unique = true;
  } else if (raw.unique) {
    spec.unique = true;
  }

  // SingleSelect / MultiSelect
  if (type === "SingleSelect" || type === "MultiSelect") {
    const colOptions = raw.colOptions as Record<string, any> | undefined;
    const rawOptions = raw.options as Record<string, any> | undefined;

    if (colOptions?.options) {
      spec.options.choices = (colOptions.options as any[]).map((choice: any) => ({
        title: choice.title,
        color: choice.color,
      }));
    } else if (rawOptions?.choices) {
      spec.options.choices = (rawOptions.choices as any[]).map((choice: any) => ({
        title: choice.title,
        color: choice.color,
      }));
    }
  }

  // DateTime
  if (type === "DateTime") {
    const meta =
      typeof raw.meta === "string" ? JSON.parse(raw.meta) : (raw.meta as Record<string, any>);

    if (meta) {
      if (meta.date_format) {
        spec.options.dateFormat = meta.date_format;
      }

      if (meta.time_format) {
        spec.options.timeFormat = meta.time_format;
      }

      if (meta.is12hrFormat !== undefined) {
        spec.options.is12hrFormat = meta.is12hrFormat;
      }
    }
  }

  // Links / LinkToAnotherRecord
  if (type === "Links" || type === "LinkToAnotherRecord") {
    const colOptions = raw.colOptions as Record<string, any> | undefined;
    const rawOptions = raw.options as Record<string, any> | undefined;

    if (colOptions) {
      const relatedTableId = colOptions.fk_related_model_id as string | undefined;

      if (relatedTableId) {
        spec.options.relatedTable = tableIdToTitle.get(relatedTableId) ?? relatedTableId;
      }

      const relType = colOptions.type as string | undefined;

      if (relType) {
        spec.options.relationType = RELATION_TYPES[relType] ?? relType;
      }
    } else if (rawOptions) {
      if (rawOptions.related_table_id) {
        spec.options.relatedTable =
          tableIdToTitle.get(rawOptions.related_table_id) ?? rawOptions.related_table_id;
      }

      if (rawOptions.relation_type) {
        spec.options.relationType = rawOptions.relation_type;
      }
    }
  }

  // Lookup
  if (type === "Lookup") {
    const colOptions = raw.colOptions as Record<string, any> | undefined;
    const rawOptions = raw.options as Record<string, any> | undefined;

    if (colOptions) {
      const relationFieldId = colOptions.fk_relation_column_id as string | undefined;
      const lookupFieldId = colOptions.fk_lookup_column_id as string | undefined;

      if (relationFieldId) {
        spec.options.relationField = fieldIdToTitle.get(relationFieldId) ?? relationFieldId;
      }

      if (lookupFieldId) {
        spec.options.lookupField = fieldIdToTitle.get(lookupFieldId) ?? lookupFieldId;
      }
    } else if (rawOptions) {
      if (rawOptions.related_field_id) {
        spec.options.relationField =
          fieldIdToTitle.get(rawOptions.related_field_id) ?? rawOptions.related_field_id;
      }

      if (rawOptions.related_table_lookup_field_id) {
        spec.options.lookupField =
          fieldIdToTitle.get(rawOptions.related_table_lookup_field_id) ??
          rawOptions.related_table_lookup_field_id;
      }
    }
  }

  // Rollup
  if (type === "Rollup") {
    const colOptions = raw.colOptions as Record<string, any> | undefined;
    const rawOptions = raw.options as Record<string, any> | undefined;

    if (colOptions) {
      const relationFieldId = colOptions.fk_relation_column_id as string | undefined;
      const rollupFieldId = colOptions.fk_rollup_column_id as string | undefined;

      if (relationFieldId) {
        spec.options.relationField = fieldIdToTitle.get(relationFieldId) ?? relationFieldId;
      }

      if (rollupFieldId) {
        spec.options.rollupField = fieldIdToTitle.get(rollupFieldId) ?? rollupFieldId;
      }

      if (colOptions.rollup_function) {
        spec.options.rollupFunction = colOptions.rollup_function;
      }
    } else if (rawOptions) {
      if (rawOptions.related_field_id) {
        spec.options.relationField =
          fieldIdToTitle.get(rawOptions.related_field_id) ?? rawOptions.related_field_id;
      }

      if (rawOptions.related_table_rollup_field_id) {
        spec.options.rollupField =
          fieldIdToTitle.get(rawOptions.related_table_rollup_field_id) ??
          rawOptions.related_table_rollup_field_id;
      }

      if (rawOptions.rollup_function) {
        spec.options.rollupFunction = rawOptions.rollup_function;
      }
    }
  }

  return stripUndefined(spec) as FieldSpec;
}

export function viewToSpec(view: NormalizedView): ViewSpec {
  return {
    title: view.title,
    type: view.type ?? "grid",
    options: {},
    filters: {},
    sorts: [],
    fields: [],
    api: {},
  };
}

export function tableToSpec(
  table: NormalizedTable,
  tableIdToTitle: Map<string, string>,
  options: ExportOptions,
): TableSpec {
  // Build fieldIdToTitle map from all fields in this table
  const fieldIdToTitle = new Map<string, string>();

  for (const field of table.fields) {
    if (field.id && field.title) {
      fieldIdToTitle.set(field.id, field.title);
    }
  }

  // Track seen relation pairs for deduplication
  const seenRelationPairs = new Set<string>();

  const fields: FieldSpec[] = [];

  for (const field of table.fields) {
    if (!options.includeSystem && field.system) {
      continue;
    }

    // Deduplicate reciprocal link fields: keep only the first side
    if (field.type === "Links" || field.type === "LinkToAnotherRecord") {
      const colOptions = field.raw.colOptions as Record<string, any> | undefined;
      const rawOptions = field.raw.options as Record<string, any> | undefined;
      const relatedModelId =
        colOptions?.fk_related_model_id ?? rawOptions?.related_table_id ?? null;

      if (relatedModelId && table.id) {
        const pairKey = [table.id, relatedModelId].sort().join(":");

        if (seenRelationPairs.has(pairKey)) {
          continue;
        }

        seenRelationPairs.add(pairKey);
      }
    }

    const spec = fieldToSpec(field, tableIdToTitle, fieldIdToTitle);

    if (spec) {
      fields.push(spec);
    }
  }

  const views: ViewSpec[] = table.views.map(viewToSpec);

  return stripUndefined({
    title: table.title,
    description: table.description,
    fields,
    views,
    api: {},
  }) as TableSpec;
}

export async function runExport(client: NocoClient, options: ExportOptions): Promise<Manifest> {
  const baseId = options.baseId;

  if (!baseId) {
    throw new CliError("export requires --base-id or a configured base context.");
  }

  // Get workspace info
  let workspaceInfo: { id?: string; title?: string } | null = null;

  if (options.workspaceId) {
    const workspaces = await client.listWorkspaces();
    workspaceInfo = workspaces.find((ws) => ws.id === options.workspaceId) ?? {
      id: options.workspaceId,
    };
  }

  // Get base info
  const bases = await client.listBases(options.workspaceId);
  const baseInfo = bases.find((b) => b.id === baseId) ?? { id: baseId, title: undefined };

  // List tables
  const tableSummaries = await client.listTables(baseId);

  // Filter tables if --table specified
  const filteredTables = options.tables
    ? tableSummaries.filter((t) =>
        options.tables!.some((name) => name.toLowerCase() === String(t.title).toLowerCase()),
      )
    : tableSummaries;

  // Build tableIdToTitle map from all tables (including non-filtered, for relation resolution)
  const tableIdToTitle = new Map<string, string>();

  for (const table of tableSummaries) {
    if (table.id && table.title) {
      tableIdToTitle.set(table.id, table.title);
    }
  }

  // Track global relation pairs across tables for deduplication
  const globalRelationPairs = new Set<string>();

  // Hydrate each table and convert
  const tables: TableSpec[] = [];

  for (const tableSummary of filteredTables) {
    const hydrated = await client.getTable(baseId, tableSummary.id!);
    const views = await client.listViews(baseId, tableSummary.id!);
    hydrated.views = views;

    // Build fieldIdToTitle including all fields across all tables for cross-table resolution
    const spec = tableToSpecWithGlobalDedup(hydrated, tableIdToTitle, options, globalRelationPairs);
    tables.push(spec);
  }

  const manifest: Manifest = {
    workspace: workspaceInfo
      ? { id: workspaceInfo.id, title: workspaceInfo.title, api: {}, orgId: undefined }
      : null,
    base: { id: baseInfo.id, title: baseInfo.title, meta: {}, api: {} },
    tables,
  };

  return stripUndefined(manifest) as Manifest;
}

function tableToSpecWithGlobalDedup(
  table: NormalizedTable,
  tableIdToTitle: Map<string, string>,
  options: ExportOptions,
  globalRelationPairs: Set<string>,
): TableSpec {
  const fieldIdToTitle = new Map<string, string>();

  for (const field of table.fields) {
    if (field.id && field.title) {
      fieldIdToTitle.set(field.id, field.title);
    }
  }

  const fields: FieldSpec[] = [];

  for (const field of table.fields) {
    if (!options.includeSystem && field.system) {
      continue;
    }

    if (field.type === "Links" || field.type === "LinkToAnotherRecord") {
      const colOptions = field.raw.colOptions as Record<string, any> | undefined;
      const rawOptions = field.raw.options as Record<string, any> | undefined;
      const relatedModelId =
        colOptions?.fk_related_model_id ?? rawOptions?.related_table_id ?? null;

      if (relatedModelId && table.id) {
        const pairKey = [table.id, relatedModelId].sort().join(":");

        if (globalRelationPairs.has(pairKey)) {
          continue;
        }

        globalRelationPairs.add(pairKey);
      }
    }

    const spec = fieldToSpec(field, tableIdToTitle, fieldIdToTitle);

    if (spec) {
      fields.push(spec);
    }
  }

  const views: ViewSpec[] = table.views.map(viewToSpec);

  return stripUndefined({
    title: table.title,
    description: table.description,
    fields,
    views,
    api: {},
  }) as TableSpec;
}
