import { CliError } from "./errors.js";
import {
  buildBaseCreatePayload,
  buildBootstrapField,
  buildFieldCreatePayload,
  buildTableCreatePayload,
  buildViewCreatePayload,
  buildWorkspaceCreatePayload,
  splitTableFields,
} from "./payloads.js";
import { countManifestResources, validateManifest } from "./manifest.js";
import type {
  ApplySummary,
  ApplySummaryEntry,
  FieldSpec,
  Manifest,
  NormalizedTable,
  NormalizedWorkspace,
  ViewSpec,
} from "./types.js";
import { normalizeCaseInsensitiveMatch, pluralize } from "./utils.js";

type TableState = {
  spec: Manifest["tables"][number];
  table: NormalizedTable;
};

function createSummary(
  mode: ApplySummary["mode"],
  apiVersion: ApplySummary["apiVersion"],
): ApplySummary {
  return {
    mode,
    apiVersion,
    entries: [],
    warnings: [],
  };
}

function recordEntry(summary: ApplySummary, entry: ApplySummaryEntry): void {
  summary.entries.push(entry);
}

function warning(summary: ApplySummary, message: string): void {
  summary.warnings.push(message);
}

function matchByTitle<T extends { title?: string }>(
  items: T[],
  title: string | undefined,
): T | undefined {
  return normalizeCaseInsensitiveMatch(items, title, (item) => item.title);
}

function ensureFieldOnTable(
  table: NormalizedTable,
  ref: { fieldId?: string; fieldTitle?: string; fallbackToPrimary?: boolean },
) {
  const match =
    (ref.fieldId && table.fields.find((field) => field.id === ref.fieldId)) ||
    (ref.fieldTitle && matchByTitle(table.fields, ref.fieldTitle));

  if (match) {
    return match;
  }

  if (ref.fallbackToPrimary) {
    return (
      table.fields.find((field) => field.primary) ||
      table.fields.find((field) => String(field.type).toLowerCase() === "id") ||
      matchByTitle(table.fields, "Id") ||
      matchByTitle(table.fields, "id")
    );
  }

  throw new CliError(
    `Could not resolve field reference "${ref.fieldTitle ?? ref.fieldId}" on table "${table.title}".`,
  );
}

function createFieldContext(
  tableState: TableState,
  tableStatesByTitle: Map<string, TableState> | null,
) {
  return {
    resolveCurrentTableField(
      _spec: FieldSpec | ViewSpec,
      ref: { fieldId?: string; fieldTitle?: string; fallbackToPrimary?: boolean },
    ) {
      const field = ensureFieldOnTable(tableState.table, ref);

      if (!field) {
        throw new CliError(`Could not resolve field on table "${tableState.table.title}".`);
      }

      return field;
    },

    resolveCurrentFieldReference(
      _spec: FieldSpec,
      ref: { fieldId?: string; fieldTitle?: string; fallbackToPrimary?: boolean },
    ) {
      const field = ensureFieldOnTable(tableState.table, ref);

      if (!field) {
        throw new CliError(
          `Could not resolve relation field on table "${tableState.table.title}".`,
        );
      }

      return field;
    },

    resolveRelatedTable(fieldSpec: FieldSpec) {
      const relatedTable =
        (fieldSpec.options.relatedTableId &&
          [...(tableStatesByTitle?.values() ?? [])]
            .map((state) => state.table)
            .find((table) => table.id === fieldSpec.options.relatedTableId)) ||
        (fieldSpec.options.relatedTable &&
          tableStatesByTitle?.get(String(fieldSpec.options.relatedTable).toLowerCase())?.table);

      if (!relatedTable) {
        throw new CliError(
          `Could not resolve related table "${fieldSpec.options.relatedTable ?? fieldSpec.options.relatedTableId}" for field "${fieldSpec.title}" on table "${tableState.table.title}".`,
        );
      }

      return relatedTable;
    },

    resolveRelatedFieldReference(
      fieldSpec: FieldSpec,
      ref: { fieldId?: string; fieldTitle?: string; fallbackToPrimary?: boolean },
    ) {
      const relatedTable = this.resolveRelatedTable(fieldSpec);
      const field = ensureFieldOnTable(relatedTable, ref);

      if (!field) {
        throw new CliError(
          `Could not resolve related field "${ref.fieldTitle ?? ref.fieldId}" on table "${relatedTable.title}".`,
        );
      }

      return field;
    },
  };
}

async function resolveWorkspace(
  client: ReturnType<typeof import("./nocodb-client.js").createNocoClient>,
  manifest: Manifest,
  options: { workspaceId?: string | null; dryRun?: boolean },
  summary: ApplySummary,
): Promise<NormalizedWorkspace | null> {
  const explicitWorkspaceId = manifest.workspace?.id || options.workspaceId;

  if (explicitWorkspaceId) {
    recordEntry(summary, {
      kind: "workspace",
      action: "selected",
      title: manifest.workspace?.title ?? explicitWorkspaceId,
      id: explicitWorkspaceId,
    });

    return {
      id: explicitWorkspaceId,
      title: manifest.workspace?.title ?? explicitWorkspaceId,
      raw: {},
    };
  }

  if (!manifest.workspace) {
    if (client.apiVersion === "v3") {
      throw new CliError(
        "Workspace is required for v3. Provide workspace.id, workspace.title, or --workspace-id.",
      );
    }

    return null;
  }

  const existing = matchByTitle(await client.listWorkspaces(), manifest.workspace.title);

  if (existing) {
    recordEntry(summary, {
      kind: "workspace",
      action: "reused",
      title: existing.title,
      id: existing.id,
    });

    return existing;
  }

  if (manifest.workspace.create === false) {
    throw new CliError(`Workspace "${manifest.workspace.title}" does not exist and create=false.`);
  }

  if (options.dryRun) {
    recordEntry(summary, {
      kind: "workspace",
      action: "planned",
      title: manifest.workspace.title,
    });

    return {
      id: `planned:workspace:${manifest.workspace.title}`,
      title: manifest.workspace.title,
      raw: {},
    };
  }

  const created = await client.createWorkspace(
    buildWorkspaceCreatePayload(client.apiVersion, manifest.workspace),
  );

  recordEntry(summary, {
    kind: "workspace",
    action: "created",
    title: created.title,
    id: created.id,
  });

  return created;
}

async function resolveBase(
  client: ReturnType<typeof import("./nocodb-client.js").createNocoClient>,
  manifest: Manifest,
  workspace: NormalizedWorkspace | null,
  summary: ApplySummary,
) {
  const baseSpec = manifest.base!;
  const explicitBaseId = baseSpec.id;

  if (explicitBaseId) {
    recordEntry(summary, {
      kind: "base",
      action: "selected",
      title: baseSpec.title ?? explicitBaseId,
      id: explicitBaseId,
    });

    return {
      id: explicitBaseId,
      title: baseSpec.title ?? explicitBaseId,
      workspaceId: workspace?.id,
      raw: {},
    };
  }

  const bases = await client.listBases(workspace?.id ?? baseSpec.workspaceId ?? null);
  const existing = matchByTitle(bases, baseSpec.title);

  if (existing) {
    recordEntry(summary, {
      kind: "base",
      action: "reused",
      title: existing.title,
      id: existing.id,
    });

    return existing;
  }

  if (baseSpec.create === false) {
    throw new CliError(`Base "${baseSpec.title}" does not exist and create=false.`);
  }

  if (summary.mode === "plan") {
    recordEntry(summary, {
      kind: "base",
      action: "planned",
      title: baseSpec.title,
    });

    return {
      id: `planned:base:${baseSpec.title}`,
      title: baseSpec.title,
      workspaceId: workspace?.id,
      raw: {},
    };
  }

  const created = await client.createBase(
    workspace?.id ?? baseSpec.workspaceId ?? null,
    buildBaseCreatePayload(client.apiVersion, baseSpec, workspace?.id),
  );

  recordEntry(summary, {
    kind: "base",
    action: "created",
    title: created.title,
    id: created.id,
  });

  return created;
}

async function createOrReuseTables(
  client: ReturnType<typeof import("./nocodb-client.js").createNocoClient>,
  manifest: Manifest,
  base: { id?: string; title?: string },
  summary: ApplySummary,
): Promise<{ tableStates: TableState[]; tableStatesByTitle: Map<string, TableState> }> {
  const existingTables =
    summary.mode === "plan" && String(base.id).startsWith("planned:")
      ? []
      : await client.listTables(base.id!);

  const tableStates: TableState[] = [];
  const tableStatesByTitle = new Map<string, TableState>();

  for (const tableSpec of manifest.tables) {
    const existing = matchByTitle(existingTables, tableSpec.title);

    if (existing) {
      const hydrated = await client.getTable(base.id!, existing.id!);
      const state = { spec: tableSpec, table: hydrated };
      tableStates.push(state);
      tableStatesByTitle.set(String(tableSpec.title).toLowerCase(), state);
      recordEntry(summary, {
        kind: "table",
        action: "reused",
        title: hydrated.title,
        id: hydrated.id,
      });
      continue;
    }

    if (tableSpec.create === false) {
      throw new CliError(`Table "${tableSpec.title}" does not exist and create=false.`);
    }

    const { simpleFields } = splitTableFields(tableSpec);
    const tableCreateFields =
      client.apiVersion === "v2" && simpleFields.length === 0
        ? [buildBootstrapField()]
        : simpleFields;

    if (client.apiVersion === "v2" && simpleFields.length === 0) {
      warning(
        summary,
        `Injected a bootstrap "Title" field while planning/creating "${tableSpec.title}" because v2 table creation requires one non-relational field.`,
      );
    }

    if (summary.mode === "plan") {
      const state: TableState = {
        spec: tableSpec,
        table: {
          id: `planned:table:${tableSpec.title}`,
          title: tableSpec.title,
          description: tableSpec.description,
          fields: tableCreateFields.map((field, index) => ({
            id: `planned:field:${tableSpec.title}:${index}`,
            title: field.title,
            type: field.type,
            primary: Boolean(field.primary),
            system: false,
            raw: {},
          })),
          views: [],
          raw: {},
        },
      };

      tableStates.push(state);
      tableStatesByTitle.set(String(tableSpec.title).toLowerCase(), state);
      recordEntry(summary, {
        kind: "table",
        action: "planned",
        title: tableSpec.title,
      });
      continue;
    }

    const created = await client.createTable(
      base.id!,
      buildTableCreatePayload(client.apiVersion, tableSpec, tableCreateFields),
    );

    const hydrated = await client.getTable(base.id!, created.id!);
    const state = { spec: tableSpec, table: hydrated };
    tableStates.push(state);
    tableStatesByTitle.set(String(tableSpec.title).toLowerCase(), state);
    recordEntry(summary, {
      kind: "table",
      action: "created",
      title: hydrated.title,
      id: hydrated.id,
    });
  }

  return { tableStates, tableStatesByTitle };
}

async function ensureFields(
  client: ReturnType<typeof import("./nocodb-client.js").createNocoClient>,
  base: { id?: string },
  tableStates: TableState[],
  tableStatesByTitle: Map<string, TableState>,
  summary: ApplySummary,
): Promise<void> {
  for (const tableState of tableStates) {
    const { simpleFields, deferredFields } = splitTableFields(tableState.spec);
    const orderedFields = [
      ...simpleFields,
      ...deferredFields.filter((field) =>
        ["Links", "LinkToAnotherRecord"].includes(field.type ?? ""),
      ),
      ...deferredFields.filter((field) => ["Lookup", "Rollup"].includes(field.type ?? "")),
    ];

    for (const fieldSpec of orderedFields) {
      const existing = matchByTitle(tableState.table.fields, fieldSpec.title);

      if (existing) {
        continue;
      }

      const context = createFieldContext(tableState, tableStatesByTitle);

      if (summary.mode === "plan") {
        recordEntry(summary, {
          kind: "field",
          action: "planned",
          tableTitle: tableState.table.title,
          title: fieldSpec.title,
        });
        continue;
      }

      await client.createField(
        base.id!,
        tableState.table.id!,
        buildFieldCreatePayload(client.apiVersion, fieldSpec, context),
      );

      tableState.table = await client.getTable(base.id!, tableState.table.id!);

      recordEntry(summary, {
        kind: "field",
        action: "created",
        tableTitle: tableState.table.title,
        title: fieldSpec.title,
      });
    }
  }
}

async function ensureViews(
  client: ReturnType<typeof import("./nocodb-client.js").createNocoClient>,
  base: { id?: string },
  tableStates: TableState[],
  summary: ApplySummary,
): Promise<void> {
  for (const tableState of tableStates) {
    if (!tableState.spec.views.length) {
      continue;
    }

    if (summary.mode !== "plan") {
      tableState.table.views = await client.listViews(base.id!, tableState.table.id!);
    }

    for (const viewSpec of tableState.spec.views) {
      const existing = matchByTitle(tableState.table.views, viewSpec.title);

      if (existing) {
        const hasSorts = Array.isArray(viewSpec.sorts) && viewSpec.sorts.length > 0;
        const hasFilters = Array.isArray(viewSpec.filters)
          ? viewSpec.filters.length > 0
          : Object.keys(viewSpec.filters ?? {}).length > 0;

        if (hasSorts || hasFilters) {
          warning(
            summary,
            `View "${viewSpec.title}" on "${tableState.table.title}" already exists. apply does not reconcile existing sorts/filters yet.`,
          );
        }
        continue;
      }

      const hasSorts = Array.isArray(viewSpec.sorts) && viewSpec.sorts.length > 0;
      const hasFilters = Array.isArray(viewSpec.filters)
        ? viewSpec.filters.length > 0
        : Object.keys(viewSpec.filters ?? {}).length > 0;

      if (client.apiVersion === "v2" && (hasSorts || hasFilters)) {
        warning(
          summary,
          `v2 apply creates the view "${viewSpec.title}" but does not sync sorts/filters. Use the request command for those extra steps.`,
        );
      }

      const context = createFieldContext(tableState, null);

      if (summary.mode === "plan") {
        recordEntry(summary, {
          kind: "view",
          action: "planned",
          tableTitle: tableState.table.title,
          title: viewSpec.title,
        });
        continue;
      }

      const created = await client.createView(
        base.id!,
        tableState.table.id!,
        buildViewCreatePayload(client.apiVersion, viewSpec, context),
      );

      tableState.table.views = [...tableState.table.views, created];
      recordEntry(summary, {
        kind: "view",
        action: "created",
        tableTitle: tableState.table.title,
        title: created.title,
        id: created.id,
      });
    }
  }
}

export async function runApply(
  client: ReturnType<typeof import("./nocodb-client.js").createNocoClient>,
  manifest: Manifest,
  options: { dryRun?: boolean; workspaceId?: string | null } = {},
): Promise<ApplySummary> {
  validateManifest(manifest);

  const summary = createSummary(options.dryRun ? "plan" : "apply", client.apiVersion);
  const workspace = await resolveWorkspace(client, manifest, options, summary);
  const base = await resolveBase(client, manifest, workspace, summary);
  const { tableStates, tableStatesByTitle } = await createOrReuseTables(
    client,
    manifest,
    base,
    summary,
  );

  await ensureFields(client, base, tableStates, tableStatesByTitle, summary);
  await ensureViews(client, base, tableStates, summary);

  summary.resourceCounts = countManifestResources(manifest);
  return summary;
}

export function formatApplySummary(summary: ApplySummary): string {
  const lines = [`${summary.mode === "plan" ? "Plan" : "Apply"} summary (${summary.apiVersion})`];

  for (const entry of summary.entries) {
    const scope = entry.tableTitle ? ` on "${entry.tableTitle}"` : "";
    const id = entry.id ? ` [${entry.id}]` : "";
    lines.push(`- ${entry.action} ${entry.kind} "${entry.title}"${scope}${id}`);
  }

  if (summary.resourceCounts) {
    lines.push(
      `- target manifest: ${pluralize(summary.resourceCounts.tables, "table")}, ${pluralize(summary.resourceCounts.fields, "field")}, ${pluralize(summary.resourceCounts.views, "view")}`,
    );
  }

  if (summary.warnings.length > 0) {
    lines.push("Warnings:");
    for (const item of summary.warnings) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join("\n");
}
