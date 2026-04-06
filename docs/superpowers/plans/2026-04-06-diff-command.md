# diff command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Terraform-style `diff` command that compares a manifest against live NocoDB state, displays a migration plan, and optionally executes it with interactive confirmation.

**Architecture:** New `src/diff.ts` module handles comparison logic, plan generation, formatting, and execution. Three new client methods (`updateField`, `deleteField`, `deleteTable`) are added to `src/nocodb-client.ts`. The CLI dispatches the `diff` command through a new case in `src/cli.ts`. Comparison works by converting live `NormalizedField` to `FieldSpec` (via existing `fieldToSpec` from `export.ts`) then doing attribute-level diff against the manifest `FieldSpec`.

**Tech Stack:** TypeScript, vitest, existing nocodb-client HTTP layer

---

### Task 1: Add new client methods to nocodb-client.ts

**Files:**
- Modify: `src/nocodb-client.ts:139-231` (inside `createNocoClient` return object)
- Test: `test/nocodb-client.test.ts`

- [ ] **Step 1: Write failing tests for updateField, deleteField, deleteTable**

```typescript
// Add to test/nocodb-client.test.ts

describe("updateField", () => {
  it("sends PATCH for v2", async () => {
    const { client, handler } = setup("v2");
    handler.mockResolvedValueOnce({ id: "fld1", title: "Name", uidt: "SingleLineText" });

    const result = await client.updateField("base1", "tbl1", "fld1", { title: "Renamed" });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        path: "/api/v2/meta/tables/tbl1/columns/fld1",
      }),
    );
    expect(result.title).toBe("Name");
  });

  it("sends PATCH for v3", async () => {
    const { client, handler } = setup("v3");
    handler.mockResolvedValueOnce({ id: "fld1", title: "Name", type: "SingleLineText" });

    await client.updateField("base1", "tbl1", "fld1", { title: "Renamed" });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        path: "/api/v3/meta/bases/base1/tables/tbl1/fields/fld1",
      }),
    );
  });
});

describe("deleteField", () => {
  it("sends DELETE for v2", async () => {
    const { client, handler } = setup("v2");
    handler.mockResolvedValueOnce({});

    await client.deleteField("base1", "tbl1", "fld1");

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/api/v2/meta/tables/tbl1/columns/fld1",
      }),
    );
  });

  it("sends DELETE for v3", async () => {
    const { client, handler } = setup("v3");
    handler.mockResolvedValueOnce({});

    await client.deleteField("base1", "tbl1", "fld1");

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/api/v3/meta/bases/base1/tables/tbl1/fields/fld1",
      }),
    );
  });
});

describe("deleteTable", () => {
  it("sends DELETE for v2", async () => {
    const { client, handler } = setup("v2");
    handler.mockResolvedValueOnce({});

    await client.deleteTable("base1", "tbl1");

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/api/v2/meta/tables/tbl1",
      }),
    );
  });

  it("sends DELETE for v3", async () => {
    const { client, handler } = setup("v3");
    handler.mockResolvedValueOnce({});

    await client.deleteTable("base1", "tbl1");

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/api/v3/meta/bases/base1/tables/tbl1",
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/nocodb-client.test.ts`
Expected: FAIL — `client.updateField is not a function` (and similar)

- [ ] **Step 3: Implement updateField, deleteField, deleteTable**

Add the following methods inside the return object of `createNocoClient` in `src/nocodb-client.ts`, after the existing `createView` method:

```typescript
    async updateField(
      baseId: string,
      tableId: string,
      fieldId: string,
      payload: Record<string, unknown>,
    ): Promise<NormalizedField> {
      const requestPath =
        apiVersion === "v2"
          ? `/meta/tables/${tableId}/columns/${fieldId}`
          : `/meta/bases/${baseId}/tables/${tableId}/fields/${fieldId}`;

      return normalizeField(await request("PATCH", requestPath, { body: payload }));
    },

    async deleteField(baseId: string, tableId: string, fieldId: string): Promise<void> {
      const requestPath =
        apiVersion === "v2"
          ? `/meta/tables/${tableId}/columns/${fieldId}`
          : `/meta/bases/${baseId}/tables/${tableId}/fields/${fieldId}`;

      await request("DELETE", requestPath);
    },

    async deleteTable(baseId: string, tableId: string): Promise<void> {
      const requestPath =
        apiVersion === "v2" ? `/meta/tables/${tableId}` : `/meta/bases/${baseId}/tables/${tableId}`;

      await request("DELETE", requestPath);
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/nocodb-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/nocodb-client.ts test/nocodb-client.test.ts
git commit -m "feat(client): add updateField, deleteField, deleteTable methods"
```

---

### Task 2: Add diff types to types.ts

**Files:**
- Modify: `src/types.ts:159-180` (after existing `ApplySummary`)

- [ ] **Step 1: Add DiffAction, DiffChange, DiffEntry, DiffPlan types**

Append the following to the end of `src/types.ts`:

```typescript
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
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add DiffAction, DiffEntry, DiffPlan, DiffOptions types"
```

---

### Task 3: Implement diff comparison logic (src/diff.ts — comparison only)

**Files:**
- Create: `src/diff.ts`
- Test: `test/diff.test.ts`

- [ ] **Step 1: Write failing tests for compareFields**

Create `test/diff.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { compareFields } from "../src/diff.js";
import type { FieldSpec, NormalizedField } from "../src/types.js";

const emptyTableIdMap = new Map<string, string>();
const emptyFieldIdMap = new Map<string, string>();

function makeNormalizedField(overrides: Partial<NormalizedField> = {}): NormalizedField {
  return {
    id: "fld1",
    title: "Name",
    type: "SingleLineText",
    primary: false,
    system: false,
    raw: {},
    ...overrides,
  };
}

function makeFieldSpec(overrides: Partial<FieldSpec> = {}): FieldSpec {
  return {
    title: "Name",
    type: "SingleLineText",
    options: {},
    api: {},
    ...overrides,
  };
}

describe("compareFields", () => {
  it("detects a field to add", () => {
    const manifestFields = [makeFieldSpec({ title: "Email", type: "Email" })];
    const liveFields: NormalizedField[] = [];

    const entries = compareFields(
      manifestFields,
      liveFields,
      "users",
      emptyTableIdMap,
      emptyFieldIdMap,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "field",
      action: "add",
      title: "Email",
      tableTitle: "users",
      blocked: false,
    });
  });

  it("detects a field to delete", () => {
    const manifestFields: FieldSpec[] = [];
    const liveFields = [makeNormalizedField({ title: "OldField", type: "SingleLineText" })];

    const entries = compareFields(
      manifestFields,
      liveFields,
      "users",
      emptyTableIdMap,
      emptyFieldIdMap,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "field",
      action: "delete",
      title: "OldField",
      tableTitle: "users",
      blocked: false,
    });
  });

  it("skips system fields for deletion", () => {
    const manifestFields: FieldSpec[] = [];
    const liveFields = [makeNormalizedField({ title: "nc_created_at", system: true })];

    const entries = compareFields(
      manifestFields,
      liveFields,
      "users",
      emptyTableIdMap,
      emptyFieldIdMap,
    );

    expect(entries).toHaveLength(0);
  });

  it("skips primary fields for deletion", () => {
    const manifestFields: FieldSpec[] = [];
    const liveFields = [makeNormalizedField({ title: "Title", primary: true })];

    const entries = compareFields(
      manifestFields,
      liveFields,
      "users",
      emptyTableIdMap,
      emptyFieldIdMap,
    );

    expect(entries).toHaveLength(0);
  });

  it("detects attribute modification", () => {
    const manifestFields = [
      makeFieldSpec({ title: "Name", type: "SingleLineText", description: "Updated desc" }),
    ];
    const liveFields = [
      makeNormalizedField({
        title: "Name",
        type: "SingleLineText",
        raw: { description: "Old desc" },
      }),
    ];

    const entries = compareFields(
      manifestFields,
      liveFields,
      "users",
      emptyTableIdMap,
      emptyFieldIdMap,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "field",
      action: "modify",
      title: "Name",
      blocked: false,
      changes: { description: { from: "Old desc", to: "Updated desc" } },
    });
  });

  it("detects type change as blocked", () => {
    const manifestFields = [makeFieldSpec({ title: "Status", type: "SingleSelect" })];
    const liveFields = [
      makeNormalizedField({ title: "Status", type: "SingleLineText" }),
    ];

    const entries = compareFields(
      manifestFields,
      liveFields,
      "users",
      emptyTableIdMap,
      emptyFieldIdMap,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "field",
      action: "type_change",
      title: "Status",
      blocked: true,
      reason: "requires --force-type-change",
      changes: { type: { from: "SingleLineText", to: "SingleSelect" } },
    });
  });

  it("reports no diff when manifest matches live", () => {
    const manifestFields = [makeFieldSpec({ title: "Name", type: "SingleLineText" })];
    const liveFields = [makeNormalizedField({ title: "Name", type: "SingleLineText" })];

    const entries = compareFields(
      manifestFields,
      liveFields,
      "users",
      emptyTableIdMap,
      emptyFieldIdMap,
    );

    expect(entries).toHaveLength(0);
  });

  it("ignores attributes not declared in manifest", () => {
    const manifestFields = [makeFieldSpec({ title: "Name", type: "SingleLineText" })];
    const liveFields = [
      makeNormalizedField({
        title: "Name",
        type: "SingleLineText",
        raw: { description: "Something", rqd: true },
      }),
    ];

    const entries = compareFields(
      manifestFields,
      liveFields,
      "users",
      emptyTableIdMap,
      emptyFieldIdMap,
    );

    expect(entries).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/diff.test.ts`
Expected: FAIL — `Cannot find module '../src/diff.js'`

- [ ] **Step 3: Implement compareFields and compareFieldAttributes in src/diff.ts**

Create `src/diff.ts`:

```typescript
import { fieldToSpec } from "./export.js";
import { normalizeCaseInsensitiveMatch } from "./utils.js";
import type {
  DiffChange,
  DiffEntry,
  FieldSpec,
  NormalizedField,
} from "./types.js";

function matchByTitle<T extends { title?: string }>(
  items: T[],
  title: string | undefined,
): T | undefined {
  return normalizeCaseInsensitiveMatch(items, title, (item) => item.title);
}

/**
 * Compare two FieldSpec-shaped objects on declared attributes only.
 * Returns a map of changed attributes, or null if no changes.
 */
function compareFieldAttributes(
  manifest: FieldSpec,
  live: FieldSpec,
): Record<string, DiffChange> | null {
  const changes: Record<string, DiffChange> = {};

  // Compare top-level scalar attributes that are declared in manifest
  const scalarKeys = ["type", "description", "defaultValue", "required", "unique"] as const;

  for (const key of scalarKeys) {
    if (manifest[key] === undefined) {
      continue;
    }

    const manifestVal = manifest[key];
    const liveVal = live[key];

    if (JSON.stringify(manifestVal) !== JSON.stringify(liveVal)) {
      changes[key] = { from: liveVal ?? null, to: manifestVal };
    }
  }

  // Compare options if manifest declares any
  if (manifest.options && Object.keys(manifest.options).length > 0) {
    for (const [optKey, manifestVal] of Object.entries(manifest.options)) {
      const liveVal = live.options?.[optKey];

      if (JSON.stringify(manifestVal) !== JSON.stringify(liveVal)) {
        changes[`options.${optKey}`] = { from: liveVal ?? null, to: manifestVal };
      }
    }
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

export function compareFields(
  manifestFields: FieldSpec[],
  liveFields: NormalizedField[],
  tableTitle: string,
  tableIdToTitle: Map<string, string>,
  fieldIdToTitle: Map<string, string>,
): DiffEntry[] {
  const entries: DiffEntry[] = [];

  // Track which live fields are matched
  const matchedLiveIds = new Set<string>();

  for (const manifestField of manifestFields) {
    const liveField = matchByTitle(liveFields, manifestField.title);

    if (!liveField) {
      // Field to add
      entries.push({
        kind: "field",
        action: "add",
        title: manifestField.title ?? "",
        tableTitle,
        type: manifestField.type,
        blocked: false,
      });
      continue;
    }

    if (liveField.id) {
      matchedLiveIds.add(liveField.id);
    }

    // Convert live field to FieldSpec for comparison
    const liveSpec = fieldToSpec(liveField, tableIdToTitle, fieldIdToTitle);

    if (!liveSpec) {
      continue;
    }

    const changes = compareFieldAttributes(manifestField, liveSpec);

    if (!changes) {
      continue;
    }

    // Check if type changed
    if (changes.type) {
      entries.push({
        kind: "field",
        action: "type_change",
        title: manifestField.title ?? "",
        tableTitle,
        type: manifestField.type,
        blocked: true,
        reason: "requires --force-type-change",
        changes,
      });
    } else {
      entries.push({
        kind: "field",
        action: "modify",
        title: manifestField.title ?? "",
        tableTitle,
        type: manifestField.type,
        blocked: false,
        changes,
      });
    }
  }

  // Find fields to delete (in live but not in manifest)
  for (const liveField of liveFields) {
    if (liveField.system || liveField.primary) {
      continue;
    }

    if (liveField.id && matchedLiveIds.has(liveField.id)) {
      continue;
    }

    // Check if this field was matched by title already
    const manifestMatch = matchByTitle(manifestFields, liveField.title);

    if (manifestMatch) {
      continue;
    }

    entries.push({
      kind: "field",
      action: "delete",
      title: liveField.title ?? "",
      tableTitle,
      type: liveField.type,
      blocked: false,
    });
  }

  return entries;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/diff.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/diff.ts test/diff.test.ts
git commit -m "feat(diff): add field comparison logic with declared-attributes-only strategy"
```

---

### Task 4: Add table-level comparison and DiffPlan generation

**Files:**
- Modify: `src/diff.ts`
- Modify: `test/diff.test.ts`

- [ ] **Step 1: Write failing tests for compareTables and buildDiffPlan**

Append to `test/diff.test.ts`:

```typescript
import { compareTables, buildDiffPlan } from "../src/diff.js";
import type { NormalizedTable, TableSpec } from "../src/types.js";

function makeTableSpec(overrides: Partial<TableSpec> = {}): TableSpec {
  return {
    title: "users",
    fields: [],
    views: [],
    api: {},
    ...overrides,
  };
}

function makeNormalizedTable(overrides: Partial<NormalizedTable> = {}): NormalizedTable {
  return {
    id: "tbl1",
    title: "users",
    fields: [],
    views: [],
    raw: {},
    ...overrides,
  };
}

describe("compareTables", () => {
  it("detects a table to add with its fields", () => {
    const manifestTables = [
      makeTableSpec({
        title: "orders",
        fields: [makeFieldSpec({ title: "amount", type: "Currency" })],
      }),
    ];
    const liveTables: NormalizedTable[] = [];

    const entries = compareTables(manifestTables, liveTables);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "table",
      action: "add",
      title: "orders",
      blocked: false,
    });
    expect(entries[0].fields).toHaveLength(1);
    expect(entries[0].fields![0]).toMatchObject({
      kind: "field",
      action: "add",
      title: "amount",
    });
  });

  it("detects a table to delete as blocked", () => {
    const manifestTables: TableSpec[] = [];
    const liveTables = [makeNormalizedTable({ title: "old_table" })];

    const entries = compareTables(manifestTables, liveTables);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "table",
      action: "delete",
      title: "old_table",
      blocked: true,
      reason: "requires --allow-drop-table",
    });
  });

  it("compares fields for matched tables", () => {
    const manifestTables = [
      makeTableSpec({
        title: "users",
        fields: [makeFieldSpec({ title: "email", type: "Email" })],
      }),
    ];
    const liveTables = [
      makeNormalizedTable({
        title: "users",
        fields: [makeNormalizedField({ id: "fld1", title: "name", type: "SingleLineText" })],
      }),
    ];

    const entries = compareTables(manifestTables, liveTables);

    // Should have field add (email) and field delete (name)
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.action === "add")?.title).toBe("email");
    expect(entries.find((e) => e.action === "delete")?.title).toBe("name");
  });

  it("returns empty for identical state", () => {
    const manifestTables = [
      makeTableSpec({
        title: "users",
        fields: [makeFieldSpec({ title: "Name", type: "SingleLineText" })],
      }),
    ];
    const liveTables = [
      makeNormalizedTable({
        title: "users",
        fields: [makeNormalizedField({ title: "Name", type: "SingleLineText" })],
      }),
    ];

    const entries = compareTables(manifestTables, liveTables);
    expect(entries).toHaveLength(0);
  });
});

describe("buildDiffPlan", () => {
  it("computes correct summary counts", () => {
    const manifestTables = [
      makeTableSpec({
        title: "users",
        fields: [
          makeFieldSpec({ title: "email", type: "Email" }),
          makeFieldSpec({ title: "status", type: "SingleSelect" }),
        ],
      }),
      makeTableSpec({ title: "orders", fields: [] }),
    ];
    const liveTables = [
      makeNormalizedTable({
        title: "users",
        fields: [
          makeNormalizedField({ id: "fld1", title: "status", type: "SingleLineText" }),
          makeNormalizedField({ id: "fld2", title: "old_col" }),
        ],
      }),
      makeNormalizedTable({ id: "tbl2", title: "deprecated" }),
    ];

    const plan = buildDiffPlan(manifestTables, liveTables);

    expect(plan.summary.tables.add).toBe(1);    // orders
    expect(plan.summary.tables.delete).toBe(1);  // deprecated
    expect(plan.summary.fields.add).toBe(1);     // email
    expect(plan.summary.fields.delete).toBe(1);  // old_col
    expect(plan.summary.fields.blocked).toBe(1); // status type_change
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/diff.test.ts`
Expected: FAIL — `compareTables is not exported` / `buildDiffPlan is not exported`

- [ ] **Step 3: Implement compareTables and buildDiffPlan in src/diff.ts**

Add to `src/diff.ts`:

```typescript
import type {
  DiffChange,
  DiffEntry,
  DiffPlan,
  FieldSpec,
  NormalizedField,
  NormalizedTable,
  TableSpec,
} from "./types.js";

export function compareTables(
  manifestTables: TableSpec[],
  liveTables: NormalizedTable[],
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const matchedLiveIds = new Set<string>();

  // Build tableIdToTitle and fieldIdToTitle from all live tables
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

  for (const manifestTable of manifestTables) {
    const liveTable = matchByTitle(liveTables, manifestTable.title);

    if (!liveTable) {
      // Table to add — include all fields as nested entries
      const fieldEntries: DiffEntry[] = manifestTable.fields.map((field) => ({
        kind: "field" as const,
        action: "add" as const,
        title: field.title ?? "",
        tableTitle: manifestTable.title ?? "",
        type: field.type,
        blocked: false,
      }));

      entries.push({
        kind: "table",
        action: "add",
        title: manifestTable.title ?? "",
        blocked: false,
        fields: fieldEntries,
      });
      continue;
    }

    if (liveTable.id) {
      matchedLiveIds.add(liveTable.id);
    }

    // Compare fields for matched table
    const fieldEntries = compareFields(
      manifestTable.fields,
      liveTable.fields,
      manifestTable.title ?? "",
      tableIdToTitle,
      fieldIdToTitle,
    );

    entries.push(...fieldEntries);
  }

  // Find tables to delete
  for (const liveTable of liveTables) {
    if (liveTable.id && matchedLiveIds.has(liveTable.id)) {
      continue;
    }

    const manifestMatch = matchByTitle(manifestTables, liveTable.title);

    if (manifestMatch) {
      continue;
    }

    entries.push({
      kind: "table",
      action: "delete",
      title: liveTable.title ?? "",
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
        summary.tables.add += 1;
      } else if (entry.action === "delete") {
        summary.tables.delete += 1;
      }
    } else if (entry.kind === "field") {
      if (entry.blocked) {
        summary.fields.blocked += 1;
      } else if (entry.action === "add") {
        summary.fields.add += 1;
      } else if (entry.action === "modify") {
        summary.fields.modify += 1;
      } else if (entry.action === "delete") {
        summary.fields.delete += 1;
      }
    }
  }

  // Also count fields inside added tables
  for (const entry of entries) {
    if (entry.kind === "table" && entry.action === "add" && entry.fields) {
      summary.fields.add += entry.fields.length;
    }
  }

  return { entries, summary };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/diff.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/diff.ts test/diff.test.ts
git commit -m "feat(diff): add table comparison and DiffPlan generation"
```

---

### Task 5: Implement plan formatting (formatDiffPlan)

**Files:**
- Modify: `src/diff.ts`
- Modify: `test/diff.test.ts`

- [ ] **Step 1: Write failing tests for formatDiffPlan**

Append to `test/diff.test.ts`:

```typescript
import { formatDiffPlan } from "../src/diff.js";
import type { DiffPlan } from "../src/types.js";

describe("formatDiffPlan", () => {
  it("formats an empty plan", () => {
    const plan: DiffPlan = {
      entries: [],
      summary: {
        tables: { add: 0, delete: 0 },
        fields: { add: 0, modify: 0, delete: 0, blocked: 0 },
      },
    };

    const output = formatDiffPlan(plan, "my-base");
    expect(output).toContain("No changes detected");
  });

  it("formats additions with + prefix", () => {
    const plan: DiffPlan = {
      entries: [
        {
          kind: "table",
          action: "add",
          title: "orders",
          blocked: false,
          fields: [
            {
              kind: "field",
              action: "add",
              title: "amount",
              tableTitle: "orders",
              type: "Currency",
              blocked: false,
            },
          ],
        },
      ],
      summary: {
        tables: { add: 1, delete: 0 },
        fields: { add: 1, modify: 0, delete: 0, blocked: 0 },
      },
    };

    const output = formatDiffPlan(plan, "my-base");
    expect(output).toContain("+ Table: orders");
    expect(output).toContain('+ field "amount"');
  });

  it("formats deletions with - prefix", () => {
    const plan: DiffPlan = {
      entries: [
        {
          kind: "field",
          action: "delete",
          title: "old_col",
          tableTitle: "users",
          blocked: false,
        },
      ],
      summary: {
        tables: { add: 0, delete: 0 },
        fields: { add: 0, modify: 0, delete: 1, blocked: 0 },
      },
    };

    const output = formatDiffPlan(plan, "my-base");
    expect(output).toContain('- field "old_col"');
  });

  it("formats type changes with ! prefix and blocked reason", () => {
    const plan: DiffPlan = {
      entries: [
        {
          kind: "field",
          action: "type_change",
          title: "status",
          tableTitle: "users",
          blocked: true,
          reason: "requires --force-type-change",
          changes: { type: { from: "SingleLineText", to: "SingleSelect" } },
        },
      ],
      summary: {
        tables: { add: 0, delete: 0 },
        fields: { add: 0, modify: 0, delete: 0, blocked: 1 },
      },
    };

    const output = formatDiffPlan(plan, "my-base");
    expect(output).toContain('! field "status"');
    expect(output).toContain("SingleLineText -> SingleSelect");
    expect(output).toContain("--force-type-change");
  });

  it("includes summary line", () => {
    const plan: DiffPlan = {
      entries: [
        { kind: "table", action: "add", title: "orders", blocked: false, fields: [] },
        { kind: "field", action: "add", title: "email", tableTitle: "users", blocked: false },
      ],
      summary: {
        tables: { add: 1, delete: 0 },
        fields: { add: 1, modify: 0, delete: 0, blocked: 0 },
      },
    };

    const output = formatDiffPlan(plan, "my-base");
    expect(output).toContain("Plan:");
    expect(output).toContain("1 table to add");
    expect(output).toContain("1 field to add");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/diff.test.ts`
Expected: FAIL — `formatDiffPlan is not exported`

- [ ] **Step 3: Implement formatDiffPlan**

Add to `src/diff.ts`:

```typescript
import { pluralize } from "./utils.js";

export function formatDiffPlan(plan: DiffPlan, baseTitle: string): string {
  if (plan.entries.length === 0) {
    return `No changes detected. Base "${baseTitle}" is up to date with the manifest.`;
  }

  const lines: string[] = [];
  lines.push(`Comparing manifest with live database...\n`);
  lines.push(`  Base: ${baseTitle}\n`);

  // Group field-level entries by table
  const tableEntries = plan.entries.filter((e) => e.kind === "table");
  const fieldEntries = plan.entries.filter((e) => e.kind === "field");

  // Group field entries by tableTitle
  const fieldsByTable = new Map<string, DiffEntry[]>();

  for (const entry of fieldEntries) {
    const table = entry.tableTitle ?? "unknown";

    if (!fieldsByTable.has(table)) {
      fieldsByTable.set(table, []);
    }

    fieldsByTable.get(table)!.push(entry);
  }

  // Render field changes grouped under existing tables
  for (const [tableTitle, fields] of fieldsByTable) {
    lines.push(`  Table: ${tableTitle}`);

    for (const field of fields) {
      lines.push(formatFieldEntry(field));
    }

    lines.push("");
  }

  // Render table-level entries
  for (const entry of tableEntries) {
    if (entry.action === "add") {
      lines.push(`  + Table: ${entry.title}`);

      if (entry.fields) {
        for (const field of entry.fields) {
          lines.push(formatFieldEntry(field));
        }
      }

      lines.push("");
    } else if (entry.action === "delete") {
      const suffix = entry.blocked ? ` -- ${entry.reason}` : "";
      lines.push(`  - Table: ${entry.title}  (will be deleted${suffix})`);
      lines.push("");
    }
  }

  // Summary line
  const parts: string[] = [];
  const { tables, fields } = plan.summary;

  if (tables.add > 0) {
    parts.push(`${tables.add} ${pluralize(tables.add, "table", "tables")} to add`);
  }

  if (tables.delete > 0) {
    parts.push(`${tables.delete} ${pluralize(tables.delete, "table", "tables")} to delete`);
  }

  if (fields.add > 0) {
    parts.push(`${fields.add} ${pluralize(fields.add, "field", "fields")} to add`);
  }

  if (fields.modify > 0) {
    parts.push(`${fields.modify} ${pluralize(fields.modify, "field", "fields")} to modify`);
  }

  if (fields.delete > 0) {
    parts.push(`${fields.delete} ${pluralize(fields.delete, "field", "fields")} to delete`);
  }

  if (fields.blocked > 0) {
    parts.push(`${fields.blocked} requires manual action`);
  }

  lines.push(`Plan: ${parts.join(", ")}.`);

  return lines.join("\n");
}

function formatFieldEntry(entry: DiffEntry): string {
  const prefix =
    entry.action === "add"
      ? "+"
      : entry.action === "modify"
        ? "~"
        : entry.action === "delete"
          ? "-"
          : "!";

  const typeInfo = entry.type ? ` (${entry.type})` : "";

  if (entry.action === "type_change" && entry.changes?.type) {
    const { from, to } = entry.changes.type;
    const suffix = entry.blocked ? ` -- ${entry.reason}` : "";
    return `    ${prefix} field "${entry.title}"          (type change: ${from} -> ${to}${suffix})`;
  }

  if (entry.action === "modify" && entry.changes) {
    const changedKeys = Object.keys(entry.changes).join(", ");
    return `    ${prefix} field "${entry.title}"          (${changedKeys} changed)`;
  }

  if (entry.action === "delete") {
    return `    ${prefix} field "${entry.title}"          (will be deleted)`;
  }

  return `    ${prefix} field "${entry.title}"         ${typeInfo}`;
}
```

Note: `pluralize` is used inconsistently in the plan code above — it already returns "N thing(s)" format. Fix the summary line to avoid double-counting: use the raw numbers instead:

```typescript
  if (tables.add > 0) {
    parts.push(`${tables.add} table${tables.add === 1 ? "" : "s"} to add`);
  }
  // ... same pattern for all
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/diff.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/diff.ts test/diff.test.ts
git commit -m "feat(diff): add Terraform-style plan formatting"
```

---

### Task 6: Implement plan execution (executePlan)

**Files:**
- Modify: `src/diff.ts`
- Modify: `test/diff.test.ts`

- [ ] **Step 1: Write failing tests for executePlan**

Append to `test/diff.test.ts`:

```typescript
import { executePlan } from "../src/diff.js";
import type { DiffPlan, DiffOptions } from "../src/types.js";

function mockClient() {
  return {
    apiVersion: "v3" as const,
    createTable: vi.fn().mockResolvedValue({ id: "tbl_new", title: "orders", fields: [], views: [], raw: {} }),
    getTable: vi.fn().mockResolvedValue({ id: "tbl_new", title: "orders", fields: [], views: [], raw: {} }),
    createField: vi.fn().mockResolvedValue({ id: "fld_new", title: "amount" }),
    updateField: vi.fn().mockResolvedValue({ id: "fld1", title: "name" }),
    deleteField: vi.fn().mockResolvedValue(undefined),
    deleteTable: vi.fn().mockResolvedValue(undefined),
    listTables: vi.fn().mockResolvedValue([]),
  };
}

// Import vi at the top of the file:
// import { describe, expect, it, vi } from "vitest";

describe("executePlan", () => {
  it("creates tables for add entries", async () => {
    const client = mockClient();
    const plan: DiffPlan = {
      entries: [
        {
          kind: "table",
          action: "add",
          title: "orders",
          blocked: false,
          fields: [
            { kind: "field", action: "add", title: "amount", tableTitle: "orders", type: "Currency", blocked: false },
          ],
        },
      ],
      summary: { tables: { add: 1, delete: 0 }, fields: { add: 1, modify: 0, delete: 0, blocked: 0 } },
    };

    const options: DiffOptions = {
      baseId: "base1",
      workspaceId: null,
      execute: true,
      allowDropTable: false,
      forceTypeChange: false,
      json: false,
    };

    const result = await executePlan(client as any, plan, options);

    expect(client.createTable).toHaveBeenCalledTimes(1);
    expect(result.executed).toBeGreaterThan(0);
  });

  it("skips blocked entries without the right flags", async () => {
    const client = mockClient();
    const plan: DiffPlan = {
      entries: [
        { kind: "table", action: "delete", title: "old", blocked: true, reason: "requires --allow-drop-table" },
        { kind: "field", action: "type_change", title: "status", tableTitle: "users", blocked: true, reason: "requires --force-type-change", changes: { type: { from: "A", to: "B" } } },
      ],
      summary: { tables: { add: 0, delete: 1 }, fields: { add: 0, modify: 0, delete: 0, blocked: 1 } },
    };

    const options: DiffOptions = {
      baseId: "base1",
      workspaceId: null,
      execute: true,
      allowDropTable: false,
      forceTypeChange: false,
      json: false,
    };

    const result = await executePlan(client as any, plan, options);

    expect(client.deleteTable).not.toHaveBeenCalled();
    expect(client.updateField).not.toHaveBeenCalled();
    expect(result.skipped).toBe(2);
  });

  it("executes blocked entries when flags are set", async () => {
    const client = mockClient();
    client.listTables.mockResolvedValue([{ id: "tbl1", title: "old", fields: [], views: [], raw: {} }]);

    const plan: DiffPlan = {
      entries: [
        { kind: "table", action: "delete", title: "old", blocked: true, reason: "requires --allow-drop-table" },
      ],
      summary: { tables: { add: 0, delete: 1 }, fields: { add: 0, modify: 0, delete: 0, blocked: 0 } },
    };

    const options: DiffOptions = {
      baseId: "base1",
      workspaceId: null,
      execute: true,
      allowDropTable: true,
      forceTypeChange: false,
      json: false,
    };

    const result = await executePlan(client as any, plan, options);

    expect(client.deleteTable).toHaveBeenCalledTimes(1);
    expect(result.executed).toBe(1);
  });

  it("deletes fields", async () => {
    const client = mockClient();
    client.listTables.mockResolvedValue([
      {
        id: "tbl1",
        title: "users",
        fields: [{ id: "fld_old", title: "old_col", type: "SingleLineText", primary: false, system: false, raw: {} }],
        views: [],
        raw: {},
      },
    ]);

    const plan: DiffPlan = {
      entries: [
        { kind: "field", action: "delete", title: "old_col", tableTitle: "users", blocked: false },
      ],
      summary: { tables: { add: 0, delete: 0 }, fields: { add: 0, modify: 0, delete: 1, blocked: 0 } },
    };

    const options: DiffOptions = {
      baseId: "base1",
      workspaceId: null,
      execute: true,
      allowDropTable: false,
      forceTypeChange: false,
      json: false,
    };

    const result = await executePlan(client as any, plan, options);

    expect(client.deleteField).toHaveBeenCalledWith("base1", "tbl1", "fld_old");
    expect(result.executed).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/diff.test.ts`
Expected: FAIL — `executePlan is not exported`

- [ ] **Step 3: Implement executePlan**

Add to `src/diff.ts`:

```typescript
import { buildFieldCreatePayload, buildTableCreatePayload, splitTableFields } from "./payloads.js";
import type { DiffOptions, NormalizedTable } from "./types.js";
import { createNocoClient } from "./nocodb-client.js";

type NocoClient = ReturnType<typeof createNocoClient>;

export interface ExecutionResult {
  executed: number;
  skipped: number;
  errors: string[];
}

export async function executePlan(
  client: NocoClient,
  plan: DiffPlan,
  options: DiffOptions,
): Promise<ExecutionResult> {
  const result: ExecutionResult = { executed: 0, skipped: 0, errors: [] };

  // Fetch current tables for ID resolution
  const liveTables = await client.listTables(options.baseId);
  const tablesByTitle = new Map<string, NormalizedTable>();

  for (const table of liveTables) {
    if (table.title) {
      tablesByTitle.set(table.title.toLowerCase(), table);
    }
  }

  // Phase 1: Add tables
  for (const entry of plan.entries) {
    if (entry.kind !== "table" || entry.action !== "add") {
      continue;
    }

    try {
      const fields = entry.fields?.map((f) => ({
        title: f.title,
        type: f.type,
        options: {},
        api: {},
      })) ?? [];

      const tableSpec = { title: entry.title, fields, views: [], api: {} };
      const { simpleFields } = splitTableFields(tableSpec);
      const created = await client.createTable(
        options.baseId,
        buildTableCreatePayload(client.apiVersion, tableSpec, simpleFields),
      );

      if (created.id && created.title) {
        const hydrated = await client.getTable(options.baseId, created.id);
        tablesByTitle.set(created.title.toLowerCase(), hydrated);
      }

      result.executed += 1;
    } catch (err: any) {
      result.errors.push(`Failed to create table "${entry.title}": ${err.message}`);
    }
  }

  // Phase 2: Add fields
  for (const entry of plan.entries) {
    if (entry.kind !== "field" || entry.action !== "add") {
      continue;
    }

    const table = tablesByTitle.get((entry.tableTitle ?? "").toLowerCase());

    if (!table?.id) {
      result.errors.push(`Cannot add field "${entry.title}": table "${entry.tableTitle}" not found`);
      continue;
    }

    try {
      const fieldSpec = { title: entry.title, type: entry.type, options: {}, api: {} };
      await client.createField(
        options.baseId,
        table.id,
        buildFieldCreatePayload(client.apiVersion, fieldSpec, {
          currentTableId: table.id,
          resolveCurrentFieldReference: () => { throw new Error("not supported in diff"); },
          resolveCurrentTableField: () => { throw new Error("not supported in diff"); },
          resolveRelatedFieldReference: () => { throw new Error("not supported in diff"); },
          resolveRelatedTable: () => { throw new Error("not supported in diff"); },
        }),
      );
      result.executed += 1;
    } catch (err: any) {
      result.errors.push(`Failed to add field "${entry.title}" on "${entry.tableTitle}": ${err.message}`);
    }
  }

  // Phase 3: Modify fields
  for (const entry of plan.entries) {
    if (entry.kind !== "field") {
      continue;
    }

    if (entry.action === "type_change") {
      if (!options.forceTypeChange) {
        result.skipped += 1;
        continue;
      }
    } else if (entry.action !== "modify") {
      continue;
    }

    const table = tablesByTitle.get((entry.tableTitle ?? "").toLowerCase());

    if (!table?.id) {
      result.errors.push(`Cannot modify field "${entry.title}": table "${entry.tableTitle}" not found`);
      continue;
    }

    const liveField = matchByTitle(table.fields, entry.title);

    if (!liveField?.id) {
      result.errors.push(`Cannot modify field "${entry.title}": field not found on "${entry.tableTitle}"`);
      continue;
    }

    try {
      const payload: Record<string, unknown> = {};

      if (entry.changes) {
        for (const [key, change] of Object.entries(entry.changes)) {
          if (key.startsWith("options.")) {
            // Options changes need to be nested
            if (!payload.options) {
              payload.options = {};
            }
            (payload.options as Record<string, unknown>)[key.slice(8)] = change.to;
          } else {
            payload[key] = change.to;
          }
        }
      }

      await client.updateField(options.baseId, table.id, liveField.id, payload);
      result.executed += 1;
    } catch (err: any) {
      result.errors.push(`Failed to modify field "${entry.title}" on "${entry.tableTitle}": ${err.message}`);
    }
  }

  // Phase 4: Delete fields
  for (const entry of plan.entries) {
    if (entry.kind !== "field" || entry.action !== "delete") {
      continue;
    }

    const table = tablesByTitle.get((entry.tableTitle ?? "").toLowerCase());

    if (!table?.id) {
      result.errors.push(`Cannot delete field "${entry.title}": table "${entry.tableTitle}" not found`);
      continue;
    }

    const liveField = matchByTitle(table.fields, entry.title);

    if (!liveField?.id) {
      result.errors.push(`Cannot delete field "${entry.title}": field not found on "${entry.tableTitle}"`);
      continue;
    }

    try {
      await client.deleteField(options.baseId, table.id, liveField.id);
      result.executed += 1;
    } catch (err: any) {
      result.errors.push(`Failed to delete field "${entry.title}" on "${entry.tableTitle}": ${err.message}`);
    }
  }

  // Phase 5: Delete tables
  for (const entry of plan.entries) {
    if (entry.kind !== "table" || entry.action !== "delete") {
      continue;
    }

    if (!options.allowDropTable) {
      result.skipped += 1;
      continue;
    }

    const table = tablesByTitle.get(entry.title.toLowerCase());

    if (!table?.id) {
      result.errors.push(`Cannot delete table "${entry.title}": table not found`);
      continue;
    }

    try {
      await client.deleteTable(options.baseId, table.id);
      result.executed += 1;
    } catch (err: any) {
      result.errors.push(`Failed to delete table "${entry.title}": ${err.message}`);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/diff.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/diff.ts test/diff.test.ts
git commit -m "feat(diff): add plan execution with phased ordering and safety flags"
```

---

### Task 7: Wire up CLI integration

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/diff.ts` (add `runDiffCommand` orchestrator)

- [ ] **Step 1: Add runDiffCommand to src/diff.ts**

This is the top-level orchestrator that is called from `cli.ts`. Add to `src/diff.ts`:

```typescript
import { CliError } from "./errors.js";
import { loadManifest, normalizeManifest } from "./manifest.js";
import { loadResolvedConfig, requireConnectionConfig } from "./config.js";
import { printOutput } from "./utils.js";
import { createNocoClient } from "./nocodb-client.js";
import { parseFlags } from "./args.js";
import readline from "node:readline";

async function fetchLiveState(
  client: NocoClient,
  baseId: string,
): Promise<NormalizedTable[]> {
  const tableSummaries = await client.listTables(baseId);
  const hydrated: NormalizedTable[] = [];

  for (const summary of tableSummaries) {
    if (summary.id) {
      hydrated.push(await client.getTable(baseId, summary.id));
    }
  }

  return hydrated;
}

async function promptConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
}

export async function runDiffCommand(
  globalConfig: Awaited<ReturnType<typeof loadResolvedConfig>>,
  args: string[],
): Promise<void> {
  const { flags, positionals } = parseFlags(args, {
    booleanFlags: ["execute", "allow-drop-table", "force-type-change"],
  });

  const manifestPath = flags.manifest ? String(flags.manifest) : positionals[0];

  if (!manifestPath) {
    throw new CliError("diff requires a manifest path. Usage: noco-meta diff --manifest <path>");
  }

  if (!globalConfig.baseId) {
    throw new CliError(
      "diff requires --base-id or a configured base context (via init / context set).",
    );
  }

  const manifest = normalizeManifest(loadManifest(manifestPath) as any);
  const client = createNocoClient(globalConfig);

  // Fetch live state
  const liveTables = await fetchLiveState(client, globalConfig.baseId);

  // Build diff plan
  const plan = buildDiffPlan(manifest.tables, liveTables);

  // Resolve base title for display
  const baseTitle = manifest.base?.title ?? globalConfig.baseId;

  // Output
  if (globalConfig.json) {
    printOutput({ plan: plan.entries, summary: plan.summary });
    return;
  }

  const formatted = formatDiffPlan(plan, baseTitle);
  printOutput(formatted);

  if (plan.entries.length === 0) {
    return;
  }

  // Execute if requested
  if (flags.execute) {
    const confirmed = await promptConfirmation("\nDo you want to execute these changes? (yes/no): ");

    if (!confirmed) {
      printOutput("Cancelled.");
      return;
    }

    const options: DiffOptions = {
      baseId: globalConfig.baseId,
      workspaceId: globalConfig.workspaceId,
      execute: true,
      allowDropTable: flags["allow-drop-table"] === true,
      forceTypeChange: flags["force-type-change"] === true,
      json: globalConfig.json,
    };

    const result = await executePlan(client, plan, options);

    if (globalConfig.json) {
      printOutput(result);
    } else {
      const parts: string[] = [];
      if (result.executed > 0) {
        parts.push(`${result.executed} operation${result.executed === 1 ? "" : "s"} executed`);
      }
      if (result.skipped > 0) {
        parts.push(`${result.skipped} skipped`);
      }
      if (result.errors.length > 0) {
        parts.push(`${result.errors.length} error${result.errors.length === 1 ? "" : "s"}`);
        for (const err of result.errors) {
          printOutput(`  Error: ${err}`);
        }
      }
      printOutput(`\nExecution complete: ${parts.join(", ")}.`);
    }
  }
}
```

- [ ] **Step 2: Add diff case to cli.ts**

Add the import at the top of `src/cli.ts`:

```typescript
import { runDiffCommand } from "./diff.js";
```

Add the case in the switch statement, before the `default:` case:

```typescript
    case "diff": {
      const globalConfig = await loadResolvedConfig(parsed.globals);
      requireConnectionConfig(globalConfig);
      await runDiffCommand(globalConfig, parsed.commandArgs);
      return;
    }
```

- [ ] **Step 3: Add diff to renderHelp()**

Add the following line to the Usage section in `renderHelp()`, after the `plan` line:

```
  noco-meta diff <manifest.json> [--execute] [--allow-drop-table] [--force-type-change]
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/diff.ts
git commit -m "feat(cli): wire up diff command with interactive confirmation"
```

---

### Task 8: Run full quality checks and fix any issues

**Files:**
- All modified/created files

- [ ] **Step 1: Run the full check suite**

Run: `npm run check`
This runs: lint + format:check + typecheck + test + knip

Expected: PASS on all checks

- [ ] **Step 2: Fix any lint/format issues**

If `format:check` fails, run:
```bash
npm run format
```

If `lint` fails, fix the reported issues.

If `knip` reports unused exports, remove them.

- [ ] **Step 3: Re-run checks to confirm**

Run: `npm run check`
Expected: PASS

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore: fix lint and format issues"
```

---

### Task 9: Manual verification and final commit

- [ ] **Step 1: Verify CLI help output**

Run: `node ./bin/noco-meta.js help`
Expected: `diff` command should appear in the usage listing.

- [ ] **Step 2: Verify diff command without connection (error handling)**

Run: `node ./bin/noco-meta.js diff`
Expected: Error about missing manifest path.

Run: `node ./bin/noco-meta.js diff test/fixtures/sample-manifest.json` (if a test fixture exists, otherwise use any JSON)
Expected: Error about missing connection config (base-url / token).

- [ ] **Step 3: Build the project**

Run: `npm run build`
Expected: PASS — `dist/noco-meta.js` produced without errors.

- [ ] **Step 4: Final commit if any changes needed**

```bash
git add -A
git commit -m "chore: final verification of diff command"
```
