# Workflow

## Quick Start

Build once before using the CLI:

```bash
npm install
npm run build
```

Set connection info:

```bash
export NOCODB_BASE_URL="https://your-nocodb.example.com"
export NOCODB_TOKEN="your-xc-token"
export NOCODB_API_VERSION="v3"
```

## Preferred Flow

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
- Existing view sorts and filters are not fully reconciled by `apply` yet. Use `request` when you need exact control.
