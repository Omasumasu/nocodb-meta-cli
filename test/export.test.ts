import { describe, expect, it } from "vitest";

import { fieldToSpec, viewToSpec, tableToSpec } from "../src/export.js";
import type { ExportOptions } from "../src/export.js";
import type { NormalizedField, NormalizedTable, NormalizedView } from "../src/types.js";

const emptyTableIdMap = new Map<string, string>();
const emptyFieldIdMap = new Map<string, string>();

const defaultExportOptions: ExportOptions = {
  baseId: "base1",
  workspaceId: null,
  tables: null,
  includeSystem: false,
};

describe("fieldToSpec", () => {
  it("converts a basic SingleLineText field", () => {
    const field: NormalizedField = {
      id: "fld1",
      title: "Name",
      type: "SingleLineText",
      primary: false,
      system: false,
      raw: { description: "A name field", rqd: true },
    };

    const spec = fieldToSpec(field, emptyTableIdMap, emptyFieldIdMap);
    expect(spec).toEqual({
      title: "Name",
      type: "SingleLineText",
      description: "A name field",
      required: true,
      options: {},
      api: {},
    });
  });

  it("converts a primary field", () => {
    const field: NormalizedField = {
      id: "fld1",
      title: "Title",
      type: "SingleLineText",
      primary: true,
      system: false,
      raw: {},
    };

    const spec = fieldToSpec(field, emptyTableIdMap, emptyFieldIdMap);
    expect(spec!.primary).toBe(true);
  });

  it("converts SingleSelect with choices (v2 colOptions)", () => {
    const field: NormalizedField = {
      id: "fld2",
      title: "Status",
      type: "SingleSelect",
      primary: false,
      system: false,
      raw: {
        colOptions: {
          options: [
            { title: "Active", color: "#00FF00" },
            { title: "Inactive", color: "#FF0000" },
          ],
        },
      },
    };

    const spec = fieldToSpec(field, emptyTableIdMap, emptyFieldIdMap);
    expect(spec!.options.choices).toEqual([
      { title: "Active", color: "#00FF00" },
      { title: "Inactive", color: "#FF0000" },
    ]);
  });

  it("converts SingleSelect with choices (v3 options)", () => {
    const field: NormalizedField = {
      id: "fld2",
      title: "Status",
      type: "SingleSelect",
      primary: false,
      system: false,
      raw: {
        options: {
          choices: [
            { title: "A", color: "#111" },
            { title: "B", color: "#222" },
          ],
        },
      },
    };

    const spec = fieldToSpec(field, emptyTableIdMap, emptyFieldIdMap);
    expect(spec!.options.choices).toEqual([
      { title: "A", color: "#111" },
      { title: "B", color: "#222" },
    ]);
  });

  it("converts DateTime with meta", () => {
    const field: NormalizedField = {
      id: "fld3",
      title: "CreatedAt",
      type: "DateTime",
      primary: false,
      system: false,
      raw: {
        meta: { date_format: "YYYY-MM-DD", time_format: "HH:mm", is12hrFormat: false },
      },
    };

    const spec = fieldToSpec(field, emptyTableIdMap, emptyFieldIdMap);
    expect(spec!.options.dateFormat).toBe("YYYY-MM-DD");
    expect(spec!.options.timeFormat).toBe("HH:mm");
    expect(spec!.options.is12hrFormat).toBe(false);
  });

  it("converts DateTime with stringified meta", () => {
    const field: NormalizedField = {
      id: "fld3",
      title: "CreatedAt",
      type: "DateTime",
      primary: false,
      system: false,
      raw: {
        meta: JSON.stringify({ date_format: "DD/MM/YYYY" }),
      },
    };

    const spec = fieldToSpec(field, emptyTableIdMap, emptyFieldIdMap);
    expect(spec!.options.dateFormat).toBe("DD/MM/YYYY");
  });

  it("converts LinkToAnotherRecord (v2 colOptions)", () => {
    const tableIdToTitle = new Map([["tbl_abc", "Companies"]]);

    const field: NormalizedField = {
      id: "fld4",
      title: "Company",
      type: "LinkToAnotherRecord",
      primary: false,
      system: false,
      raw: {
        colOptions: {
          fk_related_model_id: "tbl_abc",
          type: "hm",
        },
      },
    };

    const spec = fieldToSpec(field, tableIdToTitle, emptyFieldIdMap);
    expect(spec!.options.relatedTable).toBe("Companies");
    expect(spec!.options.relationType).toBe("hm");
  });

  it("converts Links (v3 options)", () => {
    const tableIdToTitle = new Map([["tbl_xyz", "Orders"]]);

    const field: NormalizedField = {
      id: "fld5",
      title: "OrderLink",
      type: "Links",
      primary: false,
      system: false,
      raw: {
        options: {
          related_table_id: "tbl_xyz",
          relation_type: "mm",
        },
      },
    };

    const spec = fieldToSpec(field, tableIdToTitle, emptyFieldIdMap);
    expect(spec!.options.relatedTable).toBe("Orders");
    expect(spec!.options.relationType).toBe("mm");
  });

  it("converts Lookup (v2 colOptions)", () => {
    const fieldIdToTitle = new Map([
      ["fld_rel", "CompanyLink"],
      ["fld_lkp", "CompanyName"],
    ]);

    const field: NormalizedField = {
      id: "fld6",
      title: "LookupName",
      type: "Lookup",
      primary: false,
      system: false,
      raw: {
        colOptions: {
          fk_relation_column_id: "fld_rel",
          fk_lookup_column_id: "fld_lkp",
        },
      },
    };

    const spec = fieldToSpec(field, emptyTableIdMap, fieldIdToTitle);
    expect(spec!.options.relationField).toBe("CompanyLink");
    expect(spec!.options.lookupField).toBe("CompanyName");
  });

  it("converts Rollup (v2 colOptions)", () => {
    const fieldIdToTitle = new Map([
      ["fld_rel", "OrdersLink"],
      ["fld_rlp", "Amount"],
    ]);

    const field: NormalizedField = {
      id: "fld7",
      title: "TotalAmount",
      type: "Rollup",
      primary: false,
      system: false,
      raw: {
        colOptions: {
          fk_relation_column_id: "fld_rel",
          fk_rollup_column_id: "fld_rlp",
          rollup_function: "sum",
        },
      },
    };

    const spec = fieldToSpec(field, emptyTableIdMap, fieldIdToTitle);
    expect(spec!.options.relationField).toBe("OrdersLink");
    expect(spec!.options.rollupField).toBe("Amount");
    expect(spec!.options.rollupFunction).toBe("sum");
  });

  it("returns null for field without type", () => {
    const field: NormalizedField = {
      id: "fld8",
      title: "Unknown",
      type: undefined,
      primary: false,
      system: false,
      raw: {},
    };

    expect(fieldToSpec(field, emptyTableIdMap, emptyFieldIdMap)).toBeNull();
  });

  it("includes defaultValue from cdf", () => {
    const field: NormalizedField = {
      id: "fld9",
      title: "Score",
      type: "Number",
      primary: false,
      system: false,
      raw: { cdf: 0 },
    };

    const spec = fieldToSpec(field, emptyTableIdMap, emptyFieldIdMap);
    expect(spec!.defaultValue).toBe(0);
  });
});

describe("viewToSpec", () => {
  it("converts a basic grid view", () => {
    const view: NormalizedView = {
      id: "vw1",
      title: "Grid view",
      type: "grid",
      raw: {},
    };

    const spec = viewToSpec(view);
    expect(spec.title).toBe("Grid view");
    expect(spec.type).toBe("grid");
  });

  it("defaults to grid type", () => {
    const view: NormalizedView = {
      id: "vw2",
      title: "Default",
      type: undefined,
      raw: {},
    };

    const spec = viewToSpec(view);
    expect(spec.type).toBe("grid");
  });
});

describe("tableToSpec", () => {
  it("converts a table with fields and views", () => {
    const table: NormalizedTable = {
      id: "tbl1",
      title: "Contacts",
      description: "Contact list",
      fields: [
        {
          id: "fld1",
          title: "Name",
          type: "SingleLineText",
          primary: true,
          system: false,
          raw: {},
        },
        {
          id: "fld2",
          title: "CreatedTime",
          type: "CreatedTime",
          primary: false,
          system: true,
          raw: {},
        },
      ],
      views: [{ id: "vw1", title: "Grid view", type: "grid", raw: {} }],
      raw: {},
    };

    const spec = tableToSpec(table, emptyTableIdMap, defaultExportOptions);

    expect(spec.title).toBe("Contacts");
    expect(spec.description).toBe("Contact list");
    expect(spec.fields).toHaveLength(1);
    expect(spec.fields[0].title).toBe("Name");
    expect(spec.views).toHaveLength(1);
  });

  it("includes system fields when includeSystem is true", () => {
    const table: NormalizedTable = {
      id: "tbl1",
      title: "Test",
      fields: [
        {
          id: "fld1",
          title: "Name",
          type: "SingleLineText",
          primary: true,
          system: false,
          raw: {},
        },
        {
          id: "fld2",
          title: "nc_created_at",
          type: "CreatedTime",
          primary: false,
          system: true,
          raw: {},
        },
      ],
      views: [],
      raw: {},
    };

    const spec = tableToSpec(table, emptyTableIdMap, {
      ...defaultExportOptions,
      includeSystem: true,
    });

    expect(spec.fields).toHaveLength(2);
  });

  it("deduplicates reciprocal link fields within a table", () => {
    const tableIdToTitle = new Map([
      ["tbl1", "A"],
      ["tbl2", "B"],
    ]);

    const table: NormalizedTable = {
      id: "tbl1",
      title: "A",
      fields: [
        {
          id: "fld1",
          title: "LinkToB",
          type: "Links",
          primary: false,
          system: false,
          raw: { colOptions: { fk_related_model_id: "tbl2", type: "hm" } },
        },
        {
          id: "fld2",
          title: "LinkToBAgain",
          type: "Links",
          primary: false,
          system: false,
          raw: { colOptions: { fk_related_model_id: "tbl2", type: "hm" } },
        },
      ],
      views: [],
      raw: {},
    };

    const spec = tableToSpec(table, tableIdToTitle, {
      baseId: "base1",
      workspaceId: null,
      tables: null,
      includeSystem: false,
    });

    // Only the first link field should be kept
    const linkFields = spec.fields.filter(
      (f) => f.type === "Links" || f.type === "LinkToAnotherRecord",
    );
    expect(linkFields).toHaveLength(1);
    expect(linkFields[0].title).toBe("LinkToB");
  });
});
