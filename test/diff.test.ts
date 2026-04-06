import { describe, expect, it, vi } from "vitest";

import {
  compareFields,
  compareTables,
  buildDiffPlan,
  formatDiffPlan,
  executePlan,
} from "../src/diff.js";
import type { ExecutionResult } from "../src/diff.js";
import type {
  DiffOptions,
  DiffPlan,
  FieldSpec,
  NormalizedField,
  NormalizedTable,
  TableSpec,
} from "../src/types.js";

const emptyTableIdMap = new Map<string, string>();
const emptyFieldIdMap = new Map<string, string>();

function makeField(overrides: Partial<NormalizedField> = {}): NormalizedField {
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

function makeTable(overrides: Partial<NormalizedTable> = {}): NormalizedTable {
  return {
    id: "tbl1",
    title: "Tasks",
    fields: [],
    views: [],
    raw: {},
    ...overrides,
  };
}

function makeTableSpec(overrides: Partial<TableSpec> = {}): TableSpec {
  return {
    title: "Tasks",
    fields: [],
    views: [],
    api: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// compareFields
// ---------------------------------------------------------------------------

describe("compareFields", () => {
  it("detects a field to add", () => {
    const manifest = [makeFieldSpec({ title: "NewField", type: "Number" })];
    const live: NormalizedField[] = [];

    const result = compareFields(manifest, live, "Tasks", emptyTableIdMap, emptyFieldIdMap);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("add");
    expect(result[0].title).toBe("NewField");
    expect(result[0].tableTitle).toBe("Tasks");
  });

  it("detects a field to delete", () => {
    const manifest: FieldSpec[] = [];
    const live = [makeField({ id: "fld1", title: "OldField", type: "SingleLineText" })];

    const result = compareFields(manifest, live, "Tasks", emptyTableIdMap, emptyFieldIdMap);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("delete");
    expect(result[0].title).toBe("OldField");
  });

  it("skips system fields for deletion", () => {
    const manifest: FieldSpec[] = [];
    const live = [makeField({ title: "nc_created_at", system: true })];

    const result = compareFields(manifest, live, "Tasks", emptyTableIdMap, emptyFieldIdMap);

    expect(result).toHaveLength(0);
  });

  it("skips primary fields for deletion", () => {
    const manifest: FieldSpec[] = [];
    const live = [makeField({ title: "Title", primary: true })];

    const result = compareFields(manifest, live, "Tasks", emptyTableIdMap, emptyFieldIdMap);

    expect(result).toHaveLength(0);
  });

  it("detects attribute modification", () => {
    const manifest = [
      makeFieldSpec({ title: "Name", type: "SingleLineText", description: "Updated desc" }),
    ];
    const live = [
      makeField({
        title: "Name",
        type: "SingleLineText",
        raw: { description: "Old desc" },
      }),
    ];

    const result = compareFields(manifest, live, "Tasks", emptyTableIdMap, emptyFieldIdMap);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("modify");
    expect(result[0].changes?.description).toEqual({
      from: "Old desc",
      to: "Updated desc",
    });
  });

  it("detects type change as blocked", () => {
    const manifest = [makeFieldSpec({ title: "Status", type: "SingleSelect" })];
    const live = [makeField({ title: "Status", type: "SingleLineText" })];

    const result = compareFields(manifest, live, "Tasks", emptyTableIdMap, emptyFieldIdMap);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("type_change");
    expect(result[0].blocked).toBe(true);
    expect(result[0].reason).toBe("requires --force-type-change");
  });

  it("reports no diff when manifest matches live", () => {
    const manifest = [makeFieldSpec({ title: "Name", type: "SingleLineText" })];
    const live = [makeField({ title: "Name", type: "SingleLineText" })];

    const result = compareFields(manifest, live, "Tasks", emptyTableIdMap, emptyFieldIdMap);

    expect(result).toHaveLength(0);
  });

  it("ignores attributes not declared in manifest", () => {
    // Manifest only declares title and type — does not declare description
    const manifest = [makeFieldSpec({ title: "Name", type: "SingleLineText" })];
    const live = [
      makeField({
        title: "Name",
        type: "SingleLineText",
        raw: { description: "Some desc", rqd: true },
      }),
    ];

    const result = compareFields(manifest, live, "Tasks", emptyTableIdMap, emptyFieldIdMap);

    // No diff because manifest didn't declare description or required
    expect(result).toHaveLength(0);
  });

  it("matches fields case-insensitively", () => {
    const manifest = [makeFieldSpec({ title: "name", type: "SingleLineText" })];
    const live = [makeField({ title: "Name", type: "SingleLineText" })];

    const result = compareFields(manifest, live, "Tasks", emptyTableIdMap, emptyFieldIdMap);

    expect(result).toHaveLength(0);
  });

  it("detects options change", () => {
    const manifest = [
      makeFieldSpec({
        title: "Status",
        type: "SingleSelect",
        options: {
          choices: [
            { title: "Active", color: "#00FF00" },
            { title: "Inactive", color: "#FF0000" },
          ],
        },
      }),
    ];
    const live = [
      makeField({
        title: "Status",
        type: "SingleSelect",
        raw: {
          colOptions: {
            options: [{ title: "Active", color: "#00FF00" }],
          },
        },
      }),
    ];

    const result = compareFields(manifest, live, "Tasks", emptyTableIdMap, emptyFieldIdMap);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("modify");
    expect(result[0].changes?.["options.choices"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// compareTables
// ---------------------------------------------------------------------------

describe("compareTables", () => {
  it("detects table to add with its fields", () => {
    const manifest = [
      makeTableSpec({
        title: "Projects",
        fields: [makeFieldSpec({ title: "Name", type: "SingleLineText" })],
      }),
    ];
    const live: NormalizedTable[] = [];

    const result = compareTables(manifest, live);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("add");
    expect(result[0].title).toBe("Projects");
    expect(result[0].fields).toHaveLength(1);
    expect(result[0].fields![0].action).toBe("add");
    expect(result[0].fields![0].title).toBe("Name");
  });

  it("detects table to delete as blocked", () => {
    const manifest: TableSpec[] = [];
    const live = [makeTable({ title: "OldTable" })];

    const result = compareTables(manifest, live);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("delete");
    expect(result[0].blocked).toBe(true);
    expect(result[0].reason).toBe("requires --allow-drop-table");
  });

  it("compares fields for matched tables", () => {
    const manifest = [
      makeTableSpec({
        title: "Tasks",
        fields: [
          makeFieldSpec({ title: "Name", type: "SingleLineText" }),
          makeFieldSpec({ title: "NewField", type: "Number" }),
        ],
      }),
    ];
    const live = [
      makeTable({
        title: "Tasks",
        fields: [makeField({ title: "Name", type: "SingleLineText" })],
      }),
    ];

    const result = compareTables(manifest, live);

    // Should have a modify entry for the table with nested field diffs
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("modify");
    expect(result[0].fields).toBeDefined();
    expect(result[0].fields!.some((f) => f.action === "add" && f.title === "NewField")).toBe(true);
  });

  it("returns empty for identical state", () => {
    const manifest = [
      makeTableSpec({
        title: "Tasks",
        fields: [makeFieldSpec({ title: "Name", type: "SingleLineText" })],
      }),
    ];
    const live = [
      makeTable({
        title: "Tasks",
        fields: [makeField({ title: "Name", type: "SingleLineText" })],
      }),
    ];

    const result = compareTables(manifest, live);

    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildDiffPlan
// ---------------------------------------------------------------------------

describe("buildDiffPlan", () => {
  it("computes correct summary counts", () => {
    const manifest = [
      makeTableSpec({
        title: "NewTable",
        fields: [
          makeFieldSpec({ title: "F1", type: "SingleLineText" }),
          makeFieldSpec({ title: "F2", type: "Number" }),
        ],
      }),
      makeTableSpec({
        title: "ExistingTable",
        fields: [
          makeFieldSpec({ title: "Name", type: "SingleLineText" }),
          makeFieldSpec({ title: "Extra", type: "Number" }),
        ],
      }),
    ];
    const live = [
      makeTable({
        title: "ExistingTable",
        fields: [
          makeField({ title: "Name", type: "SingleLineText" }),
          makeField({ id: "fld_old", title: "OldField", type: "Checkbox" }),
        ],
      }),
      makeTable({ title: "DropMe", fields: [] }),
    ];

    const plan = buildDiffPlan(manifest, live);

    expect(plan.summary.tables.add).toBe(1);
    expect(plan.summary.tables.delete).toBe(1);
    expect(plan.summary.fields.add).toBe(3); // 2 in NewTable + 1 in ExistingTable (Extra)
    expect(plan.summary.fields.delete).toBe(1); // OldField
  });

  it("counts blocked type changes", () => {
    const manifest = [
      makeTableSpec({
        title: "Tasks",
        fields: [makeFieldSpec({ title: "Status", type: "SingleSelect" })],
      }),
    ];
    const live = [
      makeTable({
        title: "Tasks",
        fields: [makeField({ title: "Status", type: "SingleLineText" })],
      }),
    ];

    const plan = buildDiffPlan(manifest, live);

    expect(plan.summary.fields.blocked).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// formatDiffPlan
// ---------------------------------------------------------------------------

describe("formatDiffPlan", () => {
  it("formats empty plan", () => {
    const plan: DiffPlan = {
      entries: [],
      summary: {
        tables: { add: 0, delete: 0 },
        fields: { add: 0, modify: 0, delete: 0, blocked: 0 },
      },
    };

    expect(formatDiffPlan(plan, "MyBase")).toBe("No changes detected.");
  });

  it("formats additions with + prefix", () => {
    const plan: DiffPlan = {
      entries: [
        {
          kind: "table",
          action: "add",
          title: "Projects",
          blocked: false,
          fields: [
            { kind: "field", action: "add", title: "Name", type: "SingleLineText", blocked: false },
          ],
        },
      ],
      summary: {
        tables: { add: 1, delete: 0 },
        fields: { add: 1, modify: 0, delete: 0, blocked: 0 },
      },
    };

    const output = formatDiffPlan(plan, "MyBase");

    expect(output).toContain("+ Table: Projects");
    expect(output).toContain('+ field "Name"');
    expect(output).toContain("Plan: 1 table to add, 1 field to add.");
  });

  it("formats deletions with - prefix", () => {
    const plan: DiffPlan = {
      entries: [
        {
          kind: "table",
          action: "delete",
          title: "OldTable",
          blocked: true,
          reason: "requires --allow-drop-table",
        },
      ],
      summary: {
        tables: { add: 0, delete: 1 },
        fields: { add: 0, modify: 0, delete: 0, blocked: 0 },
      },
    };

    const output = formatDiffPlan(plan, "MyBase");

    expect(output).toContain("- Table: OldTable");
    expect(output).toContain("requires --allow-drop-table");
    expect(output).toContain("Plan: 1 table to delete.");
  });

  it("formats type changes with ! prefix and blocked reason", () => {
    const plan: DiffPlan = {
      entries: [
        {
          kind: "table",
          action: "modify",
          title: "Tasks",
          blocked: false,
          fields: [
            {
              kind: "field",
              action: "type_change",
              title: "status",
              tableTitle: "Tasks",
              blocked: true,
              reason: "requires --force-type-change",
              changes: {
                type: { from: "SingleLineText", to: "SingleSelect" },
              },
            },
          ],
        },
      ],
      summary: {
        tables: { add: 0, delete: 0 },
        fields: { add: 0, modify: 0, delete: 0, blocked: 1 },
      },
    };

    const output = formatDiffPlan(plan, "MyBase");

    expect(output).toContain('! field "status"');
    expect(output).toContain("type change: SingleLineText -> SingleSelect");
    expect(output).toContain("requires --force-type-change");
    expect(output).toContain("Plan: 1 field blocked.");
  });

  it("formats modifications with ~ prefix", () => {
    const plan: DiffPlan = {
      entries: [
        {
          kind: "table",
          action: "modify",
          title: "Tasks",
          blocked: false,
          fields: [
            {
              kind: "field",
              action: "modify",
              title: "Name",
              tableTitle: "Tasks",
              blocked: false,
              changes: { description: { from: "old", to: "new" } },
            },
          ],
        },
      ],
      summary: {
        tables: { add: 0, delete: 0 },
        fields: { add: 0, modify: 1, delete: 0, blocked: 0 },
      },
    };

    const output = formatDiffPlan(plan, "MyBase");

    expect(output).toContain('~ field "Name"');
    expect(output).toContain("Plan: 1 field to modify.");
  });

  it("includes summary line", () => {
    const plan: DiffPlan = {
      entries: [{ kind: "table", action: "add", title: "T1", blocked: false, fields: [] }],
      summary: {
        tables: { add: 1, delete: 0 },
        fields: { add: 0, modify: 0, delete: 0, blocked: 0 },
      },
    };

    const output = formatDiffPlan(plan, "MyBase");

    expect(output).toContain("Plan:");
  });
});

// ---------------------------------------------------------------------------
// executePlan
// ---------------------------------------------------------------------------

describe("executePlan", () => {
  function makeMockClient() {
    return {
      apiVersion: "v2" as const,
      listTables: vi.fn().mockResolvedValue([
        makeTable({
          id: "tbl1",
          title: "Tasks",
          fields: [
            makeField({ id: "fld1", title: "Name", type: "SingleLineText", primary: true }),
            makeField({ id: "fld_old", title: "OldField", type: "Checkbox" }),
          ],
        }),
      ]),
      getTable: vi.fn().mockResolvedValue(
        makeTable({
          id: "tbl_new",
          title: "Projects",
          fields: [makeField({ id: "fld_new1", title: "Name", type: "SingleLineText" })],
        }),
      ),
      createTable: vi.fn().mockResolvedValue(makeTable({ id: "tbl_new", title: "Projects" })),
      createField: vi.fn().mockResolvedValue(makeField({ id: "fld_added" })),
      updateField: vi.fn().mockResolvedValue(makeField()),
      deleteField: vi.fn().mockResolvedValue(undefined),
      deleteTable: vi.fn().mockResolvedValue(undefined),
    };
  }

  const baseOptions: DiffOptions = {
    baseId: "base1",
    workspaceId: null,
    execute: true,
    allowDropTable: false,
    forceTypeChange: false,
    json: false,
  };

  it("creates tables for add entries", async () => {
    const client = makeMockClient();
    const plan: DiffPlan = {
      entries: [
        {
          kind: "table",
          action: "add",
          title: "Projects",
          blocked: false,
          fields: [
            {
              kind: "field",
              action: "add",
              title: "Name",
              type: "SingleLineText",
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

    const result: ExecutionResult = await executePlan(client, plan, baseOptions);

    expect(client.createTable).toHaveBeenCalledTimes(1);
    expect(client.getTable).toHaveBeenCalledTimes(1);
    expect(result.executed).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("skips blocked entries without flags", async () => {
    const client = makeMockClient();
    const plan: DiffPlan = {
      entries: [
        {
          kind: "table",
          action: "delete",
          title: "Tasks",
          blocked: true,
          reason: "requires --allow-drop-table",
        },
        {
          kind: "table",
          action: "modify",
          title: "Tasks",
          blocked: false,
          fields: [
            {
              kind: "field",
              action: "type_change",
              title: "Status",
              tableTitle: "Tasks",
              blocked: true,
              reason: "requires --force-type-change",
              changes: { type: { from: "SingleLineText", to: "SingleSelect" } },
            },
          ],
        },
      ],
      summary: {
        tables: { add: 0, delete: 1 },
        fields: { add: 0, modify: 0, delete: 0, blocked: 1 },
      },
    };

    const result = await executePlan(client, plan, baseOptions);

    expect(client.deleteTable).not.toHaveBeenCalled();
    expect(client.updateField).not.toHaveBeenCalled();
    expect(result.skipped).toBe(2); // one table delete + one type_change
    expect(result.executed).toBe(0);
  });

  it("executes blocked entries when flags are set", async () => {
    const client = makeMockClient();
    const plan: DiffPlan = {
      entries: [
        {
          kind: "table",
          action: "delete",
          title: "Tasks",
          blocked: true,
          reason: "requires --allow-drop-table",
        },
        {
          kind: "table",
          action: "modify",
          title: "Tasks",
          blocked: false,
          fields: [
            {
              kind: "field",
              action: "type_change",
              title: "Name",
              tableTitle: "Tasks",
              blocked: true,
              changes: {
                type: { from: "SingleLineText", to: "Number" },
              },
            },
          ],
        },
      ],
      summary: {
        tables: { add: 0, delete: 1 },
        fields: { add: 0, modify: 0, delete: 0, blocked: 1 },
      },
    };

    const result = await executePlan(client, plan, {
      ...baseOptions,
      allowDropTable: true,
      forceTypeChange: true,
    });

    expect(client.deleteTable).toHaveBeenCalledWith("base1", "tbl1");
    expect(client.updateField).toHaveBeenCalledTimes(1);
    expect(result.executed).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it("deletes fields with correct IDs", async () => {
    const client = makeMockClient();
    const plan: DiffPlan = {
      entries: [
        {
          kind: "table",
          action: "modify",
          title: "Tasks",
          blocked: false,
          fields: [
            {
              kind: "field",
              action: "delete",
              title: "OldField",
              tableTitle: "Tasks",
              type: "Checkbox",
              blocked: false,
            },
          ],
        },
      ],
      summary: {
        tables: { add: 0, delete: 0 },
        fields: { add: 0, modify: 0, delete: 1, blocked: 0 },
      },
    };

    const result = await executePlan(client, plan, baseOptions);

    expect(client.deleteField).toHaveBeenCalledWith("base1", "tbl1", "fld_old");
    expect(result.executed).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("catches errors per-operation and adds to errors array", async () => {
    const client = makeMockClient();
    client.deleteField.mockRejectedValue(new Error("API error"));

    const plan: DiffPlan = {
      entries: [
        {
          kind: "table",
          action: "modify",
          title: "Tasks",
          blocked: false,
          fields: [
            {
              kind: "field",
              action: "delete",
              title: "OldField",
              tableTitle: "Tasks",
              blocked: false,
            },
          ],
        },
      ],
      summary: {
        tables: { add: 0, delete: 0 },
        fields: { add: 0, modify: 0, delete: 1, blocked: 0 },
      },
    };

    const result = await executePlan(client, plan, baseOptions);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("API error");
    expect(result.executed).toBe(0);
  });
});
