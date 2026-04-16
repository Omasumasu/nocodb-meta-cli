import { CliError } from "./errors.js";
import { isDeferredField } from "./manifest.js";
import type {
  ApiVersion,
  BaseSpec,
  FieldSpec,
  TableSpec,
  ViewSpec,
  WorkspaceSpec,
} from "./types.js";
import { deepMerge, stripUndefined } from "./utils.js";

const V2_VIEW_TYPE_IDS: Record<string, number> = {
  form: 1,
  gallery: 2,
  grid: 3,
  kanban: 4,
  map: 5,
  calendar: 6,
};

type FieldContext = {
  currentTableId?: string;
  resolveCurrentFieldReference: (
    spec: FieldSpec,
    ref: { fieldId?: string; fieldTitle?: string; fallbackToPrimary?: boolean },
  ) => { id?: string };
  resolveCurrentTableField: (
    spec: FieldSpec | ViewSpec,
    ref: { fieldId?: string; fieldTitle?: string; fallbackToPrimary?: boolean },
  ) => { id?: string };
  resolveRelatedFieldReference: (
    spec: FieldSpec,
    ref: { fieldId?: string; fieldTitle?: string; fallbackToPrimary?: boolean },
  ) => { id?: string };
  resolveRelatedTable: (spec: FieldSpec) => { id?: string };
};

function applyVersionOverride<T extends Record<string, unknown>>(
  spec: { api?: any } | undefined,
  payload: T,
  apiVersion: ApiVersion,
): T {
  const withCommon = deepMerge(payload, spec?.api?.common);
  return stripUndefined(deepMerge(withCommon, spec?.api?.[apiVersion])) as T;
}

function mapRelationType(value: unknown): string {
  if (!value) {
    return "hm";
  }

  const normalized = String(value).toLowerCase();

  if (["hm", "hasmany", "has-many", "one-to-many", "1:n"].includes(normalized)) {
    return "hm";
  }

  if (["mm", "many-to-many", "n:n"].includes(normalized)) {
    return "mm";
  }

  if (["oo", "one-to-one", "1:1"].includes(normalized)) {
    return "oo";
  }

  return String(value);
}

function buildV2FieldPayload(field: FieldSpec, context: FieldContext): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: field.title,
    uidt: field.type,
    description: field.description,
    cdf: field.defaultValue,
    rqd: field.required,
    pv: field.primary,
    un: field.unique,
  };

  if (field.type === "DateTime" && Object.keys(field.options).length > 0) {
    payload.meta = {
      date_format: field.options.date_format ?? field.options.dateFormat,
      time_format: field.options.time_format ?? field.options.timeFormat,
      is12hrFormat:
        field.options.is12hrFormat ?? field.options.is12hr_format ?? field.options["12hr_format"],
    };
  }

  if (field.type === "SingleSelect" || field.type === "MultiSelect") {
    if (field.options.choices) {
      payload.colOptions = {
        options: field.options.choices,
      };
    }
  }

  if (field.type === "Lookup") {
    const relationField = context.resolveCurrentFieldReference(field, {
      fieldId: field.options.relationFieldId,
      fieldTitle: field.options.relationField,
    });
    const lookupField = context.resolveRelatedFieldReference(field, {
      fieldId: field.options.lookupFieldId,
      fieldTitle: field.options.lookupField,
    });

    payload.colOptions = {
      fk_relation_column_id: relationField.id,
      fk_lookup_column_id: lookupField.id,
    };
  }

  if (field.type === "Rollup") {
    const relationField = context.resolveCurrentFieldReference(field, {
      fieldId: field.options.relationFieldId,
      fieldTitle: field.options.relationField,
    });
    const rollupField = context.resolveRelatedFieldReference(field, {
      fieldId: field.options.rollupFieldId,
      fieldTitle: field.options.rollupField,
    });

    payload.colOptions = {
      fk_relation_column_id: relationField.id,
      fk_rollup_column_id: rollupField.id,
      rollup_function: field.options.rollupFunction,
    };
  }

  if (field.type === "Links" || field.type === "LinkToAnotherRecord") {
    const relatedTable = context.resolveRelatedTable(field);
    const relType = mapRelationType(field.options.relationType);

    if (relType === "bt") {
      payload.parentId = relatedTable.id;
      payload.childId = context.currentTableId;
    } else {
      payload.parentId = context.currentTableId;
      payload.childId = relatedTable.id;
    }
    payload.type = relType;
    payload.uidt = "LinkToAnotherRecord";
  }

  return applyVersionOverride(field, payload, "v2");
}

function buildV3FieldPayload(field: FieldSpec, context: FieldContext): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: field.title,
    type: field.type,
    description: field.description,
    default_value: field.defaultValue,
    unique: field.unique,
  };

  if (Object.keys(field.options).length > 0) {
    payload.options = { ...field.options };
  }

  if (field.type === "Links" || field.type === "LinkToAnotherRecord") {
    const relatedTable = context.resolveRelatedTable(field);
    payload.options = {
      relation_type: mapRelationType(field.options.relationType),
      related_table_id: relatedTable.id,
    };
  }

  if (field.type === "Lookup") {
    const relationField = context.resolveCurrentFieldReference(field, {
      fieldId: field.options.relationFieldId,
      fieldTitle: field.options.relationField,
    });
    const lookupField = context.resolveRelatedFieldReference(field, {
      fieldId: field.options.lookupFieldId,
      fieldTitle: field.options.lookupField,
    });

    payload.options = {
      related_field_id: relationField.id,
      related_table_lookup_field_id: lookupField.id,
    };
  }

  if (field.type === "Rollup") {
    const relationField = context.resolveCurrentFieldReference(field, {
      fieldId: field.options.relationFieldId,
      fieldTitle: field.options.relationField,
    });
    const rollupField = context.resolveRelatedFieldReference(field, {
      fieldId: field.options.rollupFieldId,
      fieldTitle: field.options.rollupField,
    });

    payload.options = {
      related_field_id: relationField.id,
      related_table_rollup_field_id: rollupField.id,
      rollup_function: field.options.rollupFunction,
    };
  }

  return applyVersionOverride(field, payload, "v3");
}

export function buildWorkspaceCreatePayload(
  apiVersion: ApiVersion,
  workspace: WorkspaceSpec,
): Record<string, unknown> {
  const payload =
    apiVersion === "v2"
      ? {
          title: workspace.title,
          description: workspace.description,
          fk_org_id: workspace.orgId,
        }
      : {
          title: workspace.title,
          org_id: workspace.orgId,
        };

  return applyVersionOverride(workspace, payload, apiVersion);
}

export function buildBaseCreatePayload(
  apiVersion: ApiVersion,
  base: BaseSpec,
  workspaceId?: string,
): Record<string, unknown> {
  const payload =
    apiVersion === "v2"
      ? {
          title: base.title,
          description: base.description,
          meta: base.meta,
          fk_workspace_id: workspaceId ?? base.workspaceId,
        }
      : {
          title: base.title,
          meta: base.meta,
        };

  return applyVersionOverride(base, payload, apiVersion);
}

export function splitTableFields(table: TableSpec): {
  simpleFields: FieldSpec[];
  deferredFields: FieldSpec[];
} {
  const simpleFields: FieldSpec[] = [];
  const deferredFields: FieldSpec[] = [];

  for (const field of table.fields) {
    if (isDeferredField(field)) {
      deferredFields.push(field);
      continue;
    }

    simpleFields.push(field);
  }

  return { simpleFields, deferredFields };
}

export function buildBootstrapField(): FieldSpec {
  return {
    title: "Title",
    type: "SingleLineText",
    description:
      "Bootstrap field injected so v2 table creation has at least one non-relational field.",
    options: {},
    api: {},
  };
}

function nullContext(): FieldContext {
  return {
    currentTableId: undefined,
    resolveCurrentFieldReference() {
      throw new CliError("Unexpected deferred field resolution during table create.");
    },
    resolveCurrentTableField() {
      throw new CliError("Unexpected deferred field resolution during table create.");
    },
    resolveRelatedFieldReference() {
      throw new CliError("Unexpected deferred field resolution during table create.");
    },
    resolveRelatedTable() {
      throw new CliError("Unexpected deferred field resolution during table create.");
    },
  };
}

export function buildTableCreatePayload(
  apiVersion: ApiVersion,
  table: TableSpec,
  fields: FieldSpec[],
): Record<string, unknown> {
  if (apiVersion === "v2") {
    const idColumn = {
      title: "Id",
      column_name: "id",
      uidt: "ID",
      dt: "int4",
      pk: true,
      ai: true,
      rqd: true,
    };
    return applyVersionOverride(
      table,
      {
        title: table.title,
        description: table.description,
        columns: [
          idColumn,
          ...fields.map((field) => buildV2FieldPayload(field, nullContext())),
        ],
      },
      "v2",
    );
  }

  return applyVersionOverride(
    table,
    {
      title: table.title,
      description: table.description,
      fields: fields.map((field) => buildV3FieldPayload(field, nullContext())),
    },
    "v3",
  );
}

export function buildFieldCreatePayload(
  apiVersion: ApiVersion,
  field: FieldSpec,
  context: FieldContext,
): Record<string, unknown> {
  return apiVersion === "v2"
    ? buildV2FieldPayload(field, context)
    : buildV3FieldPayload(field, context);
}

export function buildViewCreatePayload(
  apiVersion: ApiVersion,
  view: ViewSpec,
  context: FieldContext,
): Record<string, unknown> {
  const type = String(view.type).toLowerCase();

  if (apiVersion === "v2") {
    if (!V2_VIEW_TYPE_IDS[type]) {
      throw new CliError(`View type "${type}" is not supported for v2 apply.`);
    }

    const groupByField =
      view.options.groupByFieldId !== undefined || view.options.groupByField
        ? context.resolveCurrentTableField(view, {
            fieldId: view.options.groupByFieldId,
            fieldTitle: view.options.groupByField,
            fallbackToPrimary: false,
          })
        : null;

    return applyVersionOverride(
      view,
      {
        title: view.title,
        type: V2_VIEW_TYPE_IDS[type],
        fk_grp_col_id: groupByField?.id,
      },
      "v2",
    );
  }

  const payload: Record<string, unknown> = {
    title: view.title,
    type,
  };

  if (Object.keys(view.options).length > 0) {
    payload.options = view.options;
  }

  if (view.sorts?.length > 0) {
    payload.sorts = view.sorts.map((sort) => ({
      field_id:
        sort.fieldId ??
        context.resolveCurrentTableField(view, {
          fieldId: sort.fieldId,
          fieldTitle: sort.field,
          fallbackToPrimary: false,
        }).id,
      direction: sort.direction ?? "asc",
    }));
  }

  if (Array.isArray(view.filters)) {
    if (view.filters.length > 0) {
      payload.filters = view.filters;
    }
  } else if (Object.keys(view.filters).length > 0) {
    payload.filters = view.filters;
  }

  if (view.fields?.length > 0) {
    payload.fields = view.fields;
  }

  if (view.rowColoring) {
    payload.row_coloring = view.rowColoring;
  }

  return applyVersionOverride(view, payload, "v3");
}
