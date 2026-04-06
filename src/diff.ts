import { fieldToSpec } from "./export.js";
import { buildFieldCreatePayload, buildTableCreatePayload, splitTableFields } from "./payloads.js";
import type {
  DiffChange,
  DiffEntry,
  DiffOptions,
  DiffPlan,
  FieldSpec,
  NormalizedField,
  NormalizedTable,
  TableSpec,
} from "./types.js";
import { normalizeCaseInsensitiveMatch, pluralize } from "./utils.js";

export interface ExecutionResult {
  executed: number;
  skipped: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Field comparison (Task 3)
// ---------------------------------------------------------------------------

const SCALAR_ATTRIBUTES = ["type", "description", "defaultValue", "required", "unique"] as const;

function matchByTitle<T extends { title?: string }>(
  items: T[],
  title: string | undefined,
): T | undefined {
  return normalizeCaseInsensitiveMatch(items, title, (item) => item.title);
}

function stringify(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return stringify(a) === stringify(b);
}

export function compareFields(
  manifestFields: FieldSpec[],
  liveFields: NormalizedField[],
  tableTitle: string,
  tableIdToTitle: Map<string, string>,
  fieldIdToTitle: Map<string, string>,
): DiffEntry[] {
  const entries: DiffEntry[] = [];

  // Convert live fields to specs for comparison, indexed by lowercase title
  const liveSpecMap = new Map<string, FieldSpec>();
  const liveFieldByTitle = new Map<string, NormalizedField>();

  for (const lf of liveFields) {
    const spec = fieldToSpec(lf, tableIdToTitle, fieldIdToTitle);

    if (spec && lf.title) {
      liveSpecMap.set(lf.title.toLowerCase(), spec);
      liveFieldByTitle.set(lf.title.toLowerCase(), lf);
    }
  }

  // Track which live fields are matched
  const matchedLiveTitles = new Set<string>();

  for (const mf of manifestFields) {
    const title = mf.title ?? "";
    const liveSpec = liveSpecMap.get(title.toLowerCase());

    if (!liveSpec) {
      // Field to add
      entries.push({
        kind: "field",
        action: "add",
        title,
        tableTitle,
        type: mf.type,
        blocked: false,
      });
      continue;
    }

    matchedLiveTitles.add(title.toLowerCase());

    // Compare declared attributes only
    const changes: Record<string, DiffChange> = {};

    // Check scalar attributes — only if declared in manifest
    for (const attr of SCALAR_ATTRIBUTES) {
      if (!(attr in mf) || mf[attr] === undefined) {
        continue;
      }

      const manifestVal = mf[attr];
      const liveVal = liveSpec[attr];

      if (!valuesEqual(manifestVal, liveVal)) {
        changes[attr] = { from: liveVal, to: manifestVal };
      }
    }

    // Check options — only keys declared in manifest
    if (mf.options) {
      for (const key of Object.keys(mf.options)) {
        const manifestVal = mf.options[key];
        const liveVal = liveSpec.options?.[key];

        if (!valuesEqual(manifestVal, liveVal)) {
          changes[`options.${key}`] = { from: liveVal, to: manifestVal };
        }
      }
    }

    if (Object.keys(changes).length === 0) {
      continue;
    }

    // Type change?
    if (changes.type) {
      entries.push({
        kind: "field",
        action: "type_change",
        title,
        tableTitle,
        type: mf.type,
        blocked: true,
        reason: "requires --force-type-change",
        changes,
      });
    } else {
      entries.push({
        kind: "field",
        action: "modify",
        title,
        tableTitle,
        type: mf.type,
        blocked: false,
        changes,
      });
    }
  }

  // Detect deletions: live fields not matched, not system, not primary
  for (const lf of liveFields) {
    if (!lf.title) {
      continue;
    }

    if (matchedLiveTitles.has(lf.title.toLowerCase())) {
      continue;
    }

    if (lf.system || lf.primary) {
      continue;
    }

    entries.push({
      kind: "field",
      action: "delete",
      title: lf.title,
      tableTitle,
      type: lf.type,
      blocked: false,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Table comparison (Task 4)
// ---------------------------------------------------------------------------

function buildIdMaps(liveTables: NormalizedTable[]): {
  tableIdToTitle: Map<string, string>;
  fieldIdToTitle: Map<string, string>;
} {
  const tableIdToTitle = new Map<string, string>();
  const fieldIdToTitle = new Map<string, string>();

  for (const table of liveTables) {
    if (table.id && table.title) {
      tableIdToTitle.set(table.id, table.title);
    }

    for (const field of table.fields) {
      if (field.id && field.title) {
        fieldIdToTitle.set(field.id, field.title);
      }
    }
  }

  return { tableIdToTitle, fieldIdToTitle };
}

export function compareTables(
  manifestTables: TableSpec[],
  liveTables: NormalizedTable[],
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const { tableIdToTitle, fieldIdToTitle } = buildIdMaps(liveTables);
  const matchedLiveTitles = new Set<string>();

  for (const mt of manifestTables) {
    const title = mt.title ?? "";
    const liveTable = matchByTitle(liveTables, title);

    if (!liveTable) {
      // Table to add — include nested field entries
      const fieldEntries: DiffEntry[] = mt.fields.map((f) => ({
        kind: "field" as const,
        action: "add" as const,
        title: f.title ?? "",
        tableTitle: title,
        type: f.type,
        blocked: false,
      }));

      entries.push({
        kind: "table",
        action: "add",
        title,
        blocked: false,
        fields: fieldEntries,
      });
      continue;
    }

    matchedLiveTitles.add((liveTable.title ?? "").toLowerCase());

    // Compare fields for matched table
    const fieldDiffs = compareFields(
      mt.fields,
      liveTable.fields,
      title,
      tableIdToTitle,
      fieldIdToTitle,
    );

    if (fieldDiffs.length > 0) {
      entries.push({
        kind: "table",
        action: "modify",
        title,
        blocked: false,
        fields: fieldDiffs,
      });
    }
  }

  // Detect table deletions
  for (const lt of liveTables) {
    const ltTitle = lt.title ?? "";

    if (matchedLiveTitles.has(ltTitle.toLowerCase())) {
      continue;
    }

    // Check if this table is in the manifest (already matched above, so skip if found)
    const inManifest = matchByTitle(manifestTables, ltTitle);

    if (inManifest) {
      continue;
    }

    entries.push({
      kind: "table",
      action: "delete",
      title: ltTitle,
      blocked: true,
      reason: "requires --allow-drop-table",
    });
  }

  return entries;
}

export function buildDiffPlan(
  manifestTables: TableSpec[],
  liveTables: NormalizedTable[],
): DiffPlan {
  const entries = compareTables(manifestTables, liveTables);

  const summary = {
    tables: { add: 0, delete: 0 },
    fields: { add: 0, modify: 0, delete: 0, blocked: 0 },
  };

  for (const entry of entries) {
    if (entry.kind === "table") {
      if (entry.action === "add") {
        summary.tables.add++;
      } else if (entry.action === "delete") {
        summary.tables.delete++;
      }

      // Count nested field entries
      if (entry.fields) {
        for (const fe of entry.fields) {
          countFieldEntry(fe, summary);
        }
      }
    }
  }

  return { entries, summary };
}

function countFieldEntry(fe: DiffEntry, summary: DiffPlan["summary"]): void {
  if (fe.action === "add") {
    summary.fields.add++;
  } else if (fe.action === "modify") {
    summary.fields.modify++;
  } else if (fe.action === "delete") {
    summary.fields.delete++;
  } else if (fe.action === "type_change") {
    summary.fields.blocked++;
  }
}

// ---------------------------------------------------------------------------
// Plan formatting (Task 5)
// ---------------------------------------------------------------------------

export function formatDiffPlan(plan: DiffPlan, baseTitle: string): string {
  if (plan.entries.length === 0) {
    return "No changes detected.";
  }

  const lines: string[] = [];
  lines.push(`Diff for base: ${baseTitle}`);
  lines.push("");

  for (const entry of plan.entries) {
    if (entry.kind === "table" && entry.action === "add") {
      lines.push(`  + Table: ${entry.title}`);

      if (entry.fields) {
        for (const fe of entry.fields) {
          lines.push(`      + field "${fe.title}"  (${fe.type ?? "unknown"})`);
        }
      }

      lines.push("");
    } else if (entry.kind === "table" && entry.action === "delete") {
      lines.push(
        `  - Table: ${entry.title}  (will be deleted -- ${entry.reason ?? "requires --allow-drop-table"})`,
      );
      lines.push("");
    } else if (entry.kind === "table" && (entry.action === "modify" || entry.fields)) {
      lines.push(`  Table: ${entry.title}`);

      if (entry.fields) {
        for (const fe of entry.fields) {
          formatFieldEntry(fe, lines);
        }
      }

      lines.push("");
    }
  }

  // Summary line
  const parts: string[] = [];

  if (plan.summary.tables.add > 0) {
    parts.push(pluralize(plan.summary.tables.add, "table") + " to add");
  }

  if (plan.summary.tables.delete > 0) {
    parts.push(pluralize(plan.summary.tables.delete, "table") + " to delete");
  }

  if (plan.summary.fields.add > 0) {
    parts.push(pluralize(plan.summary.fields.add, "field") + " to add");
  }

  if (plan.summary.fields.modify > 0) {
    parts.push(pluralize(plan.summary.fields.modify, "field") + " to modify");
  }

  if (plan.summary.fields.delete > 0) {
    parts.push(pluralize(plan.summary.fields.delete, "field") + " to delete");
  }

  if (plan.summary.fields.blocked > 0) {
    parts.push(pluralize(plan.summary.fields.blocked, "field") + " blocked");
  }

  lines.push(`Plan: ${parts.join(", ")}.`);

  return lines.join("\n");
}

function formatFieldEntry(fe: DiffEntry, lines: string[]): void {
  if (fe.action === "add") {
    lines.push(`    + field "${fe.title}"  (${fe.type ?? "unknown"})`);
  } else if (fe.action === "delete") {
    lines.push(`    - field "${fe.title}"  (${fe.type ?? "unknown"})`);
  } else if (fe.action === "type_change") {
    const from = fe.changes?.type?.from ?? "unknown";
    const to = fe.changes?.type?.to ?? "unknown";
    lines.push(
      `    ! field "${fe.title}"  (type change: ${from} -> ${to} -- ${fe.reason ?? "requires --force-type-change"})`,
    );
  } else if (fe.action === "modify") {
    const attrs = fe.changes ? Object.keys(fe.changes).join(", ") : "";
    lines.push(`    ~ field "${fe.title}"  (${attrs})`);
  }
}

// ---------------------------------------------------------------------------
// Plan execution (Task 6)
// ---------------------------------------------------------------------------

type NocoClient = {
  apiVersion: "v2" | "v3";
  listTables(baseId: string): Promise<NormalizedTable[]>;
  getTable(baseId: string, tableId: string): Promise<NormalizedTable>;
  createTable(baseId: string, payload: Record<string, unknown>): Promise<NormalizedTable>;
  createField(
    baseId: string,
    tableId: string,
    payload: Record<string, unknown>,
  ): Promise<NormalizedField | null>;
  updateField(
    baseId: string,
    tableId: string,
    fieldId: string,
    payload: Record<string, unknown>,
  ): Promise<NormalizedField>;
  deleteField(baseId: string, tableId: string, fieldId: string): Promise<void>;
  deleteTable(baseId: string, tableId: string): Promise<void>;
};

function buildUpdatePayload(changes: Record<string, DiffChange>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const nestedOptions: Record<string, unknown> = {};

  for (const [key, change] of Object.entries(changes)) {
    if (key.startsWith("options.")) {
      const optionKey = key.slice("options.".length);
      nestedOptions[optionKey] = change.to;
    } else {
      payload[key] = change.to;
    }
  }

  if (Object.keys(nestedOptions).length > 0) {
    payload.options = nestedOptions;
  }

  return payload;
}

function nullContext() {
  return {
    currentTableId: undefined,
    resolveCurrentFieldReference() {
      throw new Error("Deferred field resolution not supported in diff add.");
    },
    resolveCurrentTableField() {
      throw new Error("Deferred field resolution not supported in diff add.");
    },
    resolveRelatedFieldReference() {
      throw new Error("Deferred field resolution not supported in diff add.");
    },
    resolveRelatedTable() {
      throw new Error("Deferred field resolution not supported in diff add.");
    },
  };
}

export async function executePlan(
  client: NocoClient,
  plan: DiffPlan,
  options: DiffOptions,
): Promise<ExecutionResult> {
  const result: ExecutionResult = { executed: 0, skipped: 0, errors: [] };

  // Resolve live tables for ID lookups
  let liveTables: NormalizedTable[];

  try {
    liveTables = await client.listTables(options.baseId);
  } catch (err: any) {
    result.errors.push(`Failed to list tables: ${err.message}`);
    return result;
  }

  const tablesByTitle = new Map<string, NormalizedTable>();

  for (const t of liveTables) {
    if (t.title) {
      tablesByTitle.set(t.title.toLowerCase(), t);
    }
  }

  // Collect operations by phase
  const tableAdds: DiffEntry[] = [];
  const fieldAdds: DiffEntry[] = [];
  const fieldModifies: DiffEntry[] = [];
  const fieldDeletes: DiffEntry[] = [];
  const tableDeletes: DiffEntry[] = [];

  for (const entry of plan.entries) {
    if (entry.kind === "table" && entry.action === "add") {
      tableAdds.push(entry);
    } else if (entry.kind === "table" && entry.action === "delete") {
      tableDeletes.push(entry);
    } else if (entry.kind === "table" && entry.fields) {
      for (const fe of entry.fields) {
        if (fe.action === "add") {
          fieldAdds.push(fe);
        } else if (fe.action === "modify") {
          fieldModifies.push(fe);
        } else if (fe.action === "delete") {
          fieldDeletes.push(fe);
        } else if (fe.action === "type_change") {
          if (options.forceTypeChange) {
            fieldModifies.push(fe);
          } else {
            result.skipped++;
          }
        }
      }
    }
  }

  // Phase 1: Add tables
  for (const entry of tableAdds) {
    try {
      // Build a minimal TableSpec from the entry
      const fields: FieldSpec[] = (entry.fields ?? []).map((fe) => ({
        title: fe.title,
        type: fe.type,
        options: {},
        api: {},
      }));

      const { simpleFields } = splitTableFields({
        title: entry.title,
        fields,
        views: [],
        api: {},
      });

      const payload = buildTableCreatePayload(
        client.apiVersion,
        {
          title: entry.title,
          fields,
          views: [],
          api: {},
        },
        simpleFields,
      );

      const created = await client.createTable(options.baseId, payload);

      // Hydrate to get field IDs
      if (created.id) {
        const hydrated = await client.getTable(options.baseId, created.id);
        tablesByTitle.set(entry.title.toLowerCase(), hydrated);
      }

      result.executed++;
    } catch (err: any) {
      result.errors.push(`Failed to create table "${entry.title}": ${err.message}`);
    }
  }

  // Phase 2: Add fields
  for (const entry of fieldAdds) {
    try {
      const tableTitle = entry.tableTitle ?? "";
      const liveTable = tablesByTitle.get(tableTitle.toLowerCase());

      if (!liveTable?.id) {
        result.errors.push(`Cannot add field "${entry.title}": table "${tableTitle}" not found.`);
        continue;
      }

      const fieldSpec: FieldSpec = {
        title: entry.title,
        type: entry.type,
        options: {},
        api: {},
      };

      const payload = buildFieldCreatePayload(client.apiVersion, fieldSpec, nullContext());
      await client.createField(options.baseId, liveTable.id, payload);
      result.executed++;
    } catch (err: any) {
      result.errors.push(`Failed to add field "${entry.title}": ${err.message}`);
    }
  }

  // Phase 3: Modify fields
  for (const entry of fieldModifies) {
    try {
      const tableTitle = entry.tableTitle ?? "";
      const liveTable = tablesByTitle.get(tableTitle.toLowerCase());

      if (!liveTable?.id) {
        result.errors.push(
          `Cannot modify field "${entry.title}": table "${tableTitle}" not found.`,
        );
        continue;
      }

      const liveField = matchByTitle(liveTable.fields, entry.title);

      if (!liveField?.id) {
        result.errors.push(
          `Cannot modify field "${entry.title}": field not found in table "${tableTitle}".`,
        );
        continue;
      }

      const payload = buildUpdatePayload(entry.changes ?? {});
      await client.updateField(options.baseId, liveTable.id, liveField.id, payload);
      result.executed++;
    } catch (err: any) {
      result.errors.push(`Failed to modify field "${entry.title}": ${err.message}`);
    }
  }

  // Phase 4: Delete fields
  for (const entry of fieldDeletes) {
    try {
      const tableTitle = entry.tableTitle ?? "";
      const liveTable = tablesByTitle.get(tableTitle.toLowerCase());

      if (!liveTable?.id) {
        result.errors.push(
          `Cannot delete field "${entry.title}": table "${tableTitle}" not found.`,
        );
        continue;
      }

      const liveField = matchByTitle(liveTable.fields, entry.title);

      if (!liveField?.id) {
        result.errors.push(
          `Cannot delete field "${entry.title}": field not found in table "${tableTitle}".`,
        );
        continue;
      }

      await client.deleteField(options.baseId, liveTable.id, liveField.id);
      result.executed++;
    } catch (err: any) {
      result.errors.push(`Failed to delete field "${entry.title}": ${err.message}`);
    }
  }

  // Phase 5: Delete tables
  for (const entry of tableDeletes) {
    if (!options.allowDropTable) {
      result.skipped++;
      continue;
    }

    try {
      const liveTable = tablesByTitle.get(entry.title.toLowerCase());

      if (!liveTable?.id) {
        result.errors.push(`Cannot delete table "${entry.title}": table not found.`);
        continue;
      }

      await client.deleteTable(options.baseId, liveTable.id);
      result.executed++;
    } catch (err: any) {
      result.errors.push(`Failed to delete table "${entry.title}": ${err.message}`);
    }
  }

  return result;
}
