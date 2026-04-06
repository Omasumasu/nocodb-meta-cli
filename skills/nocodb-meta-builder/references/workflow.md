# Workflow

## Quick Start

Build once before using the CLI:

```bash
npm install
npm run build
```

Initialize local access:

```bash
node ./bin/noco-meta.js init
node ./bin/noco-meta.js doctor
```

For CI or other non-interactive runs, use env vars instead:

```bash
export NOCODB_BASE_URL="https://your-nocodb.example.com"
export NOCODB_TOKEN="your-xc-token"
export NOCODB_API_VERSION="v3"
```

## Apply Flow (manifest → NocoDB)

1. Generate a starting point.

```bash
node ./bin/noco-meta.js template manifest
```

2. Save it as a JSON file in the repo.

3. Validate and inspect the plan.

```bash
node ./bin/noco-meta.js validate ./path/to/manifest.json
node ./bin/noco-meta.js plan ./path/to/manifest.json --api-version v3
```

4. Apply once the plan is acceptable.

```bash
node ./bin/noco-meta.js apply ./path/to/manifest.json --api-version v3
```

## Export Flow (NocoDB → manifest)

1. Export the current base schema to stdout or a file.

```bash
# stdout (pipe or redirect as needed)
node ./bin/noco-meta.js export

# to a file
node ./bin/noco-meta.js export --output schema.json
```

2. Validate the exported manifest.

```bash
node ./bin/noco-meta.js validate schema.json
```

3. Optional flags:

```bash
# Export specific tables only
node ./bin/noco-meta.js export --table "案内文,委任状"

# Include system fields (excluded by default)
node ./bin/noco-meta.js export --include-system

# Compact JSON (no pretty-print)
node ./bin/noco-meta.js export --compact
```

4. The exported manifest can be committed to version control, diffed, or applied to another base.

## Manifest Tips

- `workspace`, `base`, and each `table` can be identified by title.
- Field `type` should use NocoDB type names such as `SingleLineText`, `Email`, `Number`, `DateTime`, `LinkToAnotherRecord`, `Lookup`, `Rollup`.
- Relationship fields usually only need:

```json
{
  "title": "Company",
  "type": "LinkToAnotherRecord",
  "options": {
    "relationType": "hm",
    "relatedTable": "Companies"
  }
}
```

- If a payload differs by API version, use per-version overrides:

```json
{
  "title": "Status",
  "type": "SingleSelect",
  "options": {
    "choices": [{ "title": "Todo", "color": "#36BFFF" }]
  },
  "api": {
    "v2": {
      "colOptions": {
        "options": [{ "title": "Todo", "color": "#36BFFF" }]
      }
    }
  }
}
```

- Exported manifests include `ForeignKey` fields and `ID` fields that NocoDB manages internally. These are safe to keep for documentation but are not needed when applying to a new base.

## When To Use `request`

Use `request` instead of `apply` when:

- you need an endpoint that the manifest abstraction does not cover yet
- you need to send a very specific raw payload
- you are debugging a single API call

Example:

```bash
node ./bin/noco-meta.js request GET /meta/workspaces --api-version v3
node ./bin/noco-meta.js request POST /meta/tables/{tableId}/columns --body @payload.json --api-version v2
```

## Version Notes

- `v3` assumes workspace-oriented flows.
- `v2` can need extra raw overrides for advanced field and view payloads.
- v2 may require `--workspace-id` even for base listing — some NocoDB versions return 403 on `/meta/bases/` without it.
- Existing view sorts and filters are not fully reconciled by `apply` yet. Use `request` when you need exact control.
- Local interactive use expects an initialized profile. Switch profiles with `node ./bin/noco-meta.js profile use <name>` when needed.
- Use `--verbose` to see request/response details when debugging API issues.
