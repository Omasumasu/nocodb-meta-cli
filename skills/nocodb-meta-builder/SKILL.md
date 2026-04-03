---
name: nocodb-meta-builder
description: Build or update NocoDB workspaces, bases, tables, fields, and views through the `noco-meta` CLI in this repository instead of the GUI. Use when Codex needs to turn ER diagrams, schema specs, or table requirements into JSON manifests, run `plan` / `apply` against NocoDB meta API v2 or v3, or fall back to low-level `request` calls for unsupported metadata operations.
---

# Overview

Use this skill when the goal is to create or evolve NocoDB schema from code. Prefer the manifest workflow for repeatable setup, and use `request` only when the high-level abstraction does not cover a specific API payload.

## Workflow

1. Build the CLI if `dist/noco-meta.js` is missing.
   `npm run build`
2. Initialize local access before using `plan`, `apply`, or `request`.
   `node ./bin/noco-meta.js init`
3. Run `doctor` if the active profile, secure token storage, or connectivity is unclear.
   `node ./bin/noco-meta.js doctor`
4. Read [references/workflow.md](references/workflow.md) if you need manifest conventions or version caveats.
5. Start from a scaffold when no manifest exists.
   `node ./bin/noco-meta.js template manifest`
6. Write or update a JSON manifest in the workspace.
7. Validate and dry-run first.
   `node ./bin/noco-meta.js validate <manifest.json>`
   `node ./bin/noco-meta.js plan <manifest.json> --api-version v2|v3`
8. Apply only after the plan looks correct.
   `node ./bin/noco-meta.js apply <manifest.json> --api-version v2|v3`
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
