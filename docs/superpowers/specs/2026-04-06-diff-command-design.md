# diff command design spec

## Overview

`noco-meta diff` compares a JSON manifest (desired state) against the live NocoDB database (current state) and outputs a Terraform-style migration plan. Optionally executes the plan after user confirmation.

## Command interface

```bash
noco-meta diff --manifest <path>                          # plan only (dry-run)
noco-meta diff --manifest <path> --execute                # plan + confirm + execute
noco-meta diff --manifest <path> --execute --allow-drop-table    # allow table deletion
noco-meta diff --manifest <path> --execute --force-type-change   # allow field type changes
noco-meta diff --manifest <path> --json                   # machine-readable output
```

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--manifest` | string | required | Path to manifest JSON file |
| `--execute` | boolean | false | Execute the plan after confirmation |
| `--allow-drop-table` | boolean | false | Allow table deletion (otherwise plan-only warning) |
| `--force-type-change` | boolean | false | Allow field type changes (otherwise plan-only warning) |
| `--json` | boolean | false | Machine-readable JSON output |

Global flags (`--base-url`, `--token`, `--api-version`, `--profile`, etc.) are inherited from the existing CLI framework.

## Scope

### In scope

| Resource | Add | Modify | Delete |
|----------|-----|--------|--------|
| Table | yes | n/a (fields are compared individually) | `--allow-drop-table` required |
| Field | yes | yes (attributes in manifest) / type change requires `--force-type-change` | yes |

### Out of scope

- Views (add, modify, delete)
- Workspace and base creation (must already exist)
- Field reordering
- Data migration

## Comparison logic

### Matching

Tables and fields are matched by `title` using case-insensitive comparison (reuse existing `matchByTitle` / `normalizeCaseInsensitiveMatch` from `utils.ts`).

### Diff strategy: declared-attributes-only

Only attributes explicitly present in the manifest are compared against the live state. Attributes not declared in the manifest are ignored. This follows the Terraform model where the manifest represents the user's declared intent.

For example, if a manifest field declares only `{ title: "name", type: "SingleLineText" }`, then only `title` and `type` are compared. If the live field has `required: true` but the manifest doesn't mention `required`, no diff is generated.

### Diff categories

| Symbol | Color | Meaning | Execution |
|--------|-------|---------|-----------|
| `+` | green | Resource to add | Always executed with `--execute` |
| `~` | yellow | Resource to modify (non-type attributes) | Always executed with `--execute` |
| `-` | red | Resource to delete | Fields: executed with `--execute`. Tables: requires `--allow-drop-table` |
| `!` | magenta | Requires manual action or special flag | Skipped unless `--force-type-change` or `--allow-drop-table` |

## Output format

### Human-readable (default)

```
Comparing manifest with live database...

  Base: my-project

  Table: users
    + field "email"          (Email)
    ~ field "name"           (description changed)
    - field "old_column"     (will be deleted)
    ! field "status"         (type change: SingleLineText -> SingleSelect -- requires --force-type-change)

  + Table: orders
    + field "id"             (AutoNumber)
    + field "amount"         (Currency)

  - Table: deprecated_table  (will be deleted -- requires --allow-drop-table)

Plan: 1 table to add, 1 to delete. 2 fields to add, 1 to modify, 1 to delete, 1 requires manual action.

Do you want to execute these changes? (yes/no):
```

### JSON (`--json`)

```json
{
  "plan": [
    {
      "kind": "table",
      "action": "add",
      "title": "orders",
      "fields": [
        { "kind": "field", "action": "add", "title": "id", "type": "AutoNumber", "tableTitle": "orders" }
      ]
    },
    {
      "kind": "field",
      "action": "modify",
      "title": "name",
      "tableTitle": "users",
      "changes": { "description": { "from": "old desc", "to": "new desc" } }
    },
    {
      "kind": "field",
      "action": "delete",
      "title": "old_column",
      "tableTitle": "users"
    },
    {
      "kind": "field",
      "action": "type_change",
      "title": "status",
      "tableTitle": "users",
      "blocked": true,
      "reason": "requires --force-type-change",
      "changes": { "type": { "from": "SingleLineText", "to": "SingleSelect" } }
    },
    {
      "kind": "table",
      "action": "delete",
      "title": "deprecated_table",
      "blocked": true,
      "reason": "requires --allow-drop-table"
    }
  ],
  "summary": {
    "tables": { "add": 1, "delete": 1 },
    "fields": { "add": 2, "modify": 1, "delete": 1, "blocked": 1 }
  }
}
```

## Execution flow

```
1. Load manifest -> normalizeManifest()
2. Resolve config -> loadResolvedConfig() + requireConnectionConfig()
3. Create client -> createNocoClient()
4. Fetch live state:
   a. Resolve workspace/base (reuse resolveWorkspace/resolveBase pattern from apply.ts)
   b. listTables(baseId) -> for each: getTable(baseId, tableId) to hydrate fields
5. Compare:
   a. For each manifest table, find match in live tables
   b. Unmatched manifest tables -> action: "add"
   c. Unmatched live tables -> action: "delete" (if not system tables)
   d. Matched tables -> compare fields:
      - For each manifest field, find match in live fields
      - Unmatched manifest fields -> action: "add"
      - Unmatched live fields (non-system, non-primary) -> action: "delete"
      - Matched fields -> compare declared attributes:
        - type differs -> action: "type_change" (blocked unless --force-type-change)
        - other attributes differ -> action: "modify"
6. Generate plan (list of DiffEntry)
7. Display plan (human-readable or JSON)
8. If --execute:
   a. Prompt "Do you want to execute these changes? (yes/no):"
   b. On "yes":
      - Execute in order: add tables -> add fields -> modify fields -> delete fields -> delete tables
      - Deferred fields (Links -> Lookup/Rollup) handled in dependency order
   c. Display execution summary
```

### Execution order rationale

- Tables added first (new fields need their parent table)
- Fields added before modifications (modifications may reference new fields)
- Deletions last (minimize dependency issues)
- Within field additions, simple fields before deferred fields (Links before Lookup/Rollup)

### Safety: system fields and primary fields

The following are never deleted or modified, even if absent from the manifest:

- System fields (`system: true` in NormalizedField)
- Primary fields (`primary: true` in NormalizedField)

These are filtered out during diff comparison.

## New API methods (nocodb-client.ts)

```typescript
updateField(baseId: string, tableId: string, fieldId: string, payload: Record<string, unknown>): Promise<NormalizedField>
// PATCH /api/v2/meta/bases/{baseId}/tables/{tableId}/fields/{fieldId}
// or POST /api/v3/meta/bases/{baseId}/tables/{tableId}/fields/{fieldId} (v3 uses POST for update)

deleteField(baseId: string, tableId: string, fieldId: string): Promise<void>
// DELETE /api/v2/meta/bases/{baseId}/tables/{tableId}/fields/{fieldId}

deleteTable(baseId: string, tableId: string): Promise<void>
// DELETE /api/v2/meta/bases/{baseId}/tables/{tableId}
```

## New types

```typescript
type DiffAction = "add" | "modify" | "delete" | "type_change";

interface DiffChange {
  from: unknown;
  to: unknown;
}

interface DiffEntry {
  kind: "table" | "field";
  action: DiffAction;
  title: string;
  tableTitle?: string;       // for fields
  type?: string;             // field type
  blocked: boolean;          // true if requires special flag
  reason?: string;           // why blocked
  changes?: Record<string, DiffChange>;  // attribute diffs
  fields?: DiffEntry[];      // for table adds, nested field entries
}

interface DiffPlan {
  entries: DiffEntry[];
  summary: {
    tables: { add: number; delete: number };
    fields: { add: number; modify: number; delete: number; blocked: number };
  };
}
```

## New file

`src/diff.ts` containing:

- `runDiff(client, manifest, options)` - orchestrates comparison and returns DiffPlan
- `compareTables(manifestTables, liveTables)` - table-level diff
- `compareFields(manifestFields, liveFields)` - field-level diff
- `compareFieldAttributes(manifestField, liveField)` - attribute-level diff
- `executePlan(client, plan, baseId, context)` - executes the migration
- `formatDiffPlan(plan)` - human-readable output
- `buildFieldUpdatePayload(apiVersion, field, changes)` - builds update API payload

## CLI integration (cli.ts)

```typescript
case "diff": {
  const globalConfig = await loadResolvedConfig(parsed.globals);
  requireConnectionConfig(globalConfig);
  const client = createNocoClient(globalConfig);
  const { flags, rest } = parseFlags(parsed.commandArgs, {
    booleanFlags: ["execute", "allow-drop-table", "force-type-change", "json"],
    stringFlags: ["manifest"],
  });
  const manifestPath = flags.manifest ?? rest[0];
  // ... load manifest, run diff, optionally execute
  return;
}
```

## Field attribute comparison details

When comparing matched fields, extract comparable attributes from both manifest FieldSpec and live NormalizedField:

1. Convert live NormalizedField back to a FieldSpec-like shape (reuse `fieldToSpec` from export.ts)
2. For each attribute declared in the manifest FieldSpec, compare with the converted live value
3. Ignore attributes not present in the manifest

This approach reuses the export.ts conversion logic to normalize both sides into the same shape before comparison.

## Error handling

- Missing manifest file -> CliError with details
- Connection failure -> existing error handling from config.ts
- Base not found -> CliError "Base not found. Run 'apply' first or check your config."
- Partial execution failure -> report which operations succeeded/failed, do not rollback completed operations (same as apply behavior)
