import path from "node:path";

import { CliError } from "./errors.js";
import type { FieldSpec, Manifest, ResourceCounts, TableSpec, ViewSpec } from "./types.js";
import { readJsonFile } from "./utils.js";

const RELATION_FIELD_TYPES = new Set(["Links", "LinkToAnotherRecord"]);
const DERIVED_FIELD_TYPES = new Set(["Lookup", "Rollup"]);

function pick(
  source: Record<string, any> | undefined,
  keys: string[],
  fallback: any = undefined,
): any {
  for (const key of keys) {
    if (source?.[key] !== undefined) {
      return source[key];
    }
  }

  return fallback;
}

function normalizeFieldOptions(rawOptions: Record<string, any> = {}): Record<string, any> {
  const options = { ...rawOptions };

  const aliases: Array<[string, string[]]> = [
    ["relationType", ["relationType", "relation_type"]],
    ["relatedTable", ["relatedTable", "related_table", "relatedTableTitle"]],
    ["relatedTableId", ["relatedTableId", "related_table_id"]],
    ["sourceField", ["sourceField", "source_field"]],
    ["sourceFieldId", ["sourceFieldId", "source_field_id"]],
    ["relatedField", ["relatedField", "related_field"]],
    ["relatedFieldId", ["relatedFieldId", "related_field_id"]],
    ["relationField", ["relationField", "relation_field", "relatedField", "related_field"]],
    [
      "relationFieldId",
      ["relationFieldId", "relation_field_id", "relatedFieldId", "related_field_id"],
    ],
    [
      "lookupField",
      ["lookupField", "lookup_field", "relatedTableLookupField", "related_table_lookup_field"],
    ],
    [
      "lookupFieldId",
      [
        "lookupFieldId",
        "lookup_field_id",
        "relatedTableLookupFieldId",
        "related_table_lookup_field_id",
      ],
    ],
    [
      "rollupField",
      ["rollupField", "rollup_field", "relatedTableRollupField", "related_table_rollup_field"],
    ],
    [
      "rollupFieldId",
      [
        "rollupFieldId",
        "rollup_field_id",
        "relatedTableRollupFieldId",
        "related_table_rollup_field_id",
      ],
    ],
    ["rollupFunction", ["rollupFunction", "rollup_function"]],
    ["groupByField", ["groupByField", "group_by_field"]],
    ["groupByFieldId", ["groupByFieldId", "group_by_field_id", "fk_grp_col_id"]],
    ["choices", ["choices"]],
  ];

  for (const [canonicalKey, aliasKeys] of aliases) {
    const value = pick(rawOptions, aliasKeys);
    if (value !== undefined) {
      options[canonicalKey] = value;
    }
  }

  return options;
}

function normalizeField(rawField: Record<string, any> = {}): FieldSpec {
  return {
    title: pick(rawField, ["title", "name"]),
    type: pick(rawField, ["type", "uidt"]),
    description: pick(rawField, ["description"]),
    defaultValue: pick(rawField, ["defaultValue", "default_value", "cdf"]),
    required: pick(rawField, ["required", "rqd"]),
    unique: pick(rawField, ["unique", "un"]),
    primary: pick(rawField, ["primary", "pv"]),
    options: normalizeFieldOptions(rawField.options ?? rawField.meta ?? rawField.colOptions ?? {}),
    api: rawField.api ?? {},
  };
}

function normalizeView(rawView: Record<string, any> = {}): ViewSpec {
  return {
    title: pick(rawView, ["title", "name"]),
    type: String(pick(rawView, ["type", "viewType", "view_type"], "grid")).toLowerCase(),
    options: normalizeFieldOptions(rawView.options ?? {}),
    filters: rawView.filters ?? [],
    sorts: rawView.sorts ?? [],
    fields: rawView.fields ?? [],
    rowColoring: rawView.rowColoring ?? rawView.row_coloring,
    api: rawView.api ?? {},
  };
}

function normalizeTable(rawTable: Record<string, any> = {}): TableSpec {
  return {
    title: pick(rawTable, ["title", "name"]),
    description: pick(rawTable, ["description"]),
    create: pick(rawTable, ["create"], true),
    fields: (rawTable.fields ?? rawTable.columns ?? []).map(normalizeField),
    views: (rawTable.views ?? []).map(normalizeView),
    api: rawTable.api ?? {},
  };
}

export function normalizeManifest(rawManifest: Record<string, any> = {}): Manifest {
  return {
    workspace: rawManifest.workspace
      ? {
          id: pick(rawManifest.workspace, ["id", "workspaceId", "workspace_id"]),
          title: pick(rawManifest.workspace, ["title", "name"]),
          description: pick(rawManifest.workspace, ["description"]),
          orgId: pick(rawManifest.workspace, ["orgId", "org_id", "fk_org_id"]),
          create: pick(rawManifest.workspace, ["create"], true),
          api: rawManifest.workspace.api ?? {},
        }
      : null,
    base: rawManifest.base
      ? {
          id: pick(rawManifest.base, ["id", "baseId", "base_id"]),
          title: pick(rawManifest.base, ["title", "name"]),
          description: pick(rawManifest.base, ["description"]),
          workspaceId: pick(rawManifest.base, ["workspaceId", "workspace_id", "fk_workspace_id"]),
          create: pick(rawManifest.base, ["create"], true),
          meta: rawManifest.base.meta ?? {},
          api: rawManifest.base.api ?? {},
        }
      : (null as unknown as Manifest["base"]),
    tables: (rawManifest.tables ?? []).map(normalizeTable),
  };
}

export function loadManifest(filePath: string): Manifest {
  return normalizeManifest(readJsonFile(path.resolve(filePath)));
}

function isRelationField(field: FieldSpec): boolean {
  return RELATION_FIELD_TYPES.has(field.type ?? "");
}

function isDerivedField(field: FieldSpec): boolean {
  return DERIVED_FIELD_TYPES.has(field.type ?? "");
}

export function isDeferredField(field: FieldSpec): boolean {
  return isRelationField(field) || isDerivedField(field);
}

export function validateManifest(manifest: Manifest): Manifest {
  const problems: string[] = [];

  if (!manifest.base) {
    problems.push("base is required");
  }

  if (!manifest.base?.id && !manifest.base?.title) {
    problems.push("base.id or base.title is required");
  }

  manifest.tables.forEach((table, tableIndex) => {
    if (!table.title) {
      problems.push(`tables[${tableIndex}].title is required`);
    }

    table.fields.forEach((field, fieldIndex) => {
      if (!field.title) {
        problems.push(`tables[${tableIndex}].fields[${fieldIndex}].title is required`);
      }

      if (!field.type) {
        problems.push(`tables[${tableIndex}].fields[${fieldIndex}].type is required`);
      }

      if (isRelationField(field)) {
        const hasRawOverride = Boolean(field.api?.v2 || field.api?.v3);
        const relatedTableDefined = field.options.relatedTable || field.options.relatedTableId;

        if (!hasRawOverride && !relatedTableDefined) {
          problems.push(
            `tables[${tableIndex}].fields[${fieldIndex}] relation fields need options.relatedTable or options.relatedTableId`,
          );
        }
      }

      if (field.type === "Lookup") {
        const hasRawOverride = Boolean(field.api?.v2 || field.api?.v3);
        const relationField = field.options.relationField || field.options.relationFieldId;
        const lookupField = field.options.lookupField || field.options.lookupFieldId;

        if (!hasRawOverride && (!relationField || !lookupField)) {
          problems.push(
            `tables[${tableIndex}].fields[${fieldIndex}] lookup fields need relationField and lookupField`,
          );
        }
      }

      if (field.type === "Rollup") {
        const hasRawOverride = Boolean(field.api?.v2 || field.api?.v3);
        const relationField = field.options.relationField || field.options.relationFieldId;
        const rollupField = field.options.rollupField || field.options.rollupFieldId;

        if (!hasRawOverride && (!relationField || !rollupField || !field.options.rollupFunction)) {
          problems.push(
            `tables[${tableIndex}].fields[${fieldIndex}] rollup fields need relationField, rollupField and rollupFunction`,
          );
        }
      }
    });

    table.views.forEach((view, viewIndex) => {
      if (!view.title) {
        problems.push(`tables[${tableIndex}].views[${viewIndex}].title is required`);
      }
    });
  });

  if (problems.length > 0) {
    throw new CliError("Manifest validation failed.", {
      details: problems,
    });
  }

  return manifest;
}

export function countManifestResources(manifest: Manifest): ResourceCounts {
  return {
    tables: manifest.tables.length,
    fields: manifest.tables.reduce((count, table) => count + table.fields.length, 0),
    views: manifest.tables.reduce((count, table) => count + table.views.length, 0),
  };
}

export function createExampleManifest(): Record<string, unknown> {
  return {
    workspace: {
      title: "AI Schema Playground",
    },
    base: {
      title: "CRM",
      meta: {
        icon_color: "#36BFFF",
      },
    },
    tables: [
      {
        title: "Companies",
        fields: [
          {
            title: "Name",
            type: "SingleLineText",
            required: true,
          },
          {
            title: "Domain",
            type: "URL",
          },
        ],
        views: [
          {
            title: "All Companies",
            type: "grid",
          },
        ],
      },
      {
        title: "Contacts",
        fields: [
          {
            title: "Full Name",
            type: "SingleLineText",
            required: true,
          },
          {
            title: "Email",
            type: "Email",
            unique: true,
          },
          {
            title: "Company",
            type: "LinkToAnotherRecord",
            options: {
              relationType: "hm",
              relatedTable: "Companies",
            },
          },
        ],
        views: [
          {
            title: "All Contacts",
            type: "grid",
          },
        ],
      },
    ],
  };
}
