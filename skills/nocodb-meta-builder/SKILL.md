---
name: nocodb-meta-builder
description: Build, export, or update NocoDB workspaces, bases, tables, fields, and views through the `noco-meta` CLI in this repository instead of the GUI. Use when Codex needs to turn ER diagrams, schema specs, or table requirements into JSON manifests, export existing NocoDB schema to manifests, run `plan` / `apply` / `export` against NocoDB meta API v2 or v3, or fall back to low-level `request` calls for unsupported metadata operations.
---

# Overview

Use this skill when the goal is to create, inspect, or evolve NocoDB schema from code. Two main workflows exist:

- **Apply workflow** — manifest JSON → NocoDB (create/update schema)
- **Export workflow** — NocoDB → manifest JSON (capture existing schema for version control or diff)

Use `request` only when the high-level abstraction does not cover a specific API payload.

## Workflow

1. Build the CLI if `dist/noco-meta.js` is missing.
   `npm run build`
2. Initialize local access before using `plan`, `apply`, `export`, or `request`.
   `node ./bin/noco-meta.js init`
3. Run `doctor` to verify the active profile, token, workspace-id, and connectivity.
   `node ./bin/noco-meta.js doctor`
   - If `connection.ok` is false, check the token and workspace-id.
   - v2 may require `--workspace-id` even though workspaces are optional in v2 — some NocoDB versions block `/meta/bases/` without it.
4. Read [references/workflow.md](references/workflow.md) if you need manifest conventions or version caveats.

### Apply (manifest → NocoDB)

5. Start from a scaffold when no manifest exists.
   `node ./bin/noco-meta.js template manifest`
6. Write or update a JSON manifest in the workspace.
7. Validate and dry-run first.
   `node ./bin/noco-meta.js validate <manifest.json>`
   `node ./bin/noco-meta.js plan <manifest.json> --api-version v2|v3`
8. Apply only after the plan looks correct.
   `node ./bin/noco-meta.js apply <manifest.json> --api-version v2|v3`

### Export (NocoDB → manifest)

5. Export the current base schema.
   `node ./bin/noco-meta.js export`
   `node ./bin/noco-meta.js export --output schema.json`
6. Validate the exported manifest.
   `node ./bin/noco-meta.js validate schema.json`
7. Use `--table` to export specific tables only.
   `node ./bin/noco-meta.js export --table "案内文,委任状"`
8. Use `--include-system` to include system fields (excluded by default).
9. Use `--compact` for minified JSON output.

### Round-trip verification

Export an existing base, then validate to confirm the manifest is well-formed:

```bash
node ./bin/noco-meta.js export --output exported.json
node ./bin/noco-meta.js validate exported.json
```

### Low-level requests

9. Use `request` for unsupported or low-level operations.
   `node ./bin/noco-meta.js request METHOD PATH [--body @payload.json]`

## Rules

- Prefer `init` + managed profiles for local work.
- Prefer `NOCODB_BASE_URL` and `NOCODB_TOKEN` only for CI or other non-interactive runs.
- Treat legacy `.nocodb-meta-cli.json` as an init helper, not the primary auth path.
- Prefer manifest-driven creation for `workspace`, `base`, `table`, `field`, and `view`.
- Declare each relationship once in the manifest. Do not model both directions unless you intentionally want two separate fields.
- Use `api.common`, `api.v2`, or `api.v3` overrides when the generated payload is not enough.
- Expect more raw payload escapes on `v2` than on `v3`.
- If the task is only a one-off unsupported endpoint call, skip manifest authoring and use `request`.
- Run `doctor` after changing tokens or profiles to verify connectivity before running other commands.
- When using v2 and `/meta/bases/` returns 403, pass `--workspace-id` explicitly.

## Troubleshooting

| Symptom                                  | Likely cause            | Fix                                                                                                  |
| ---------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `doctor` shows `connection.ok: false`    | Token expired or wrong  | Re-issue API token in NocoDB GUI → Team & Settings → API Tokens, then `noco-meta auth set <profile>` |
| 403 on `/meta/bases/`                    | Missing workspace scope | Pass `--workspace-id <id>`                                                                           |
| `export` fails with "requires --base-id" | No base configured      | Run `noco-meta context set --base-id <id>` or pass `--base-id`                                       |
