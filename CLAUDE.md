# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NocoDB の meta API (v2/v3) を CLI から操作する TypeScript 製ツール。JSON manifest を元に workspace / base / table / field / view をまとめて宣言的に作成する。

## Commands

```bash
npm run build          # vite でビルド → dist/noco-meta.js
npm run test           # vitest run
npm run test:watch     # vitest (watch mode)
npm run lint           # oxlint . --deny-warnings
npm run format         # oxfmt .
npm run format:check   # oxfmt . --check
npm run typecheck      # tsc --noEmit
npm run knip           # dead code / unused deps 検出
npm run check          # lint + format:check + typecheck + test + knip を一括実行
```

単一テストを実行: `npx vitest run test/manifest.test.ts`

CLI 実行: `npm run start -- <command> [args]` or `node ./bin/noco-meta.js <command> [args]`

## Architecture

### エントリポイントとビルド

- `bin/noco-meta.js` — CLI エントリポイント。`dist/noco-meta.js` を動的に import
- `vite.config.ts` — lib モードで `src/cli.ts` をバンドル。Node builtins は external。出力は ES module 単一ファイル

### コア処理フロー

CLI コマンドの実行は以下の流れで処理される:

1. **`src/cli.ts`** — コマンドディスパッチ。`parseArgv` でコマンドとグローバルフラグを分離し、switch で振り分け
2. **`src/config.ts`** — 設定解決。優先順位: CLI flags > env vars > project context > profile > legacy config
3. **`src/nocodb-client.ts`** — NocoDB API クライアント。v2/v3 の差異を吸収し、レスポンスを `Normalized*` 型に正規化
4. **`src/apply.ts`** — manifest apply のオーケストレーション。workspace → base → tables → fields → views の順に resolve/create

### Manifest パイプライン

manifest の処理は 3 段階:

1. **`src/manifest.ts`** — JSON 読み込み、フィールド名の正規化（camelCase/snake_case aliases 吸収）、バリデーション
2. **`src/payloads.ts`** — `FieldSpec`/`ViewSpec` を v2/v3 用の API payload に変換。`api.common`/`api.v2`/`api.v3` による raw override を `deepMerge` で適用
3. **`src/apply.ts`** — 既存リソースとのマッチング（title ベース、case-insensitive）、deferred fields（Links → Lookup/Rollup の順）の依存解決

### Profile と認証

- **`src/admin.ts`** — `init`, `profile`, `auth`, `context`, `doctor` の対話型コマンド群
- **`src/state.ts`** — `~/.config/nocodb-meta-cli/profiles.json` と `.noco-meta/context.json` の読み書き
- **`src/secret-store.ts`** — OS 別 secure storage（macOS Keychain, Linux secret-tool）。token は平文ファイルに保存しない
- **`src/paths.ts`** — 設定ファイルのパス解決

### v2/v3 の差異

`nocodb-client.ts` と `payloads.ts` の両方で v2/v3 分岐がある:

- v2: field は `uidt` / `colOptions` / `columns`、view 作成は型別エンドポイント
- v3: field は `type` / `options` / `fields`、view は統一エンドポイント
- v3 は workspace が必須

## Conventions

- ESM only (`"type": "module"`)、import パスには `.js` 拡張子を付ける
- linter は oxlint、formatter は oxfmt（prettier/eslint ではない）
- テストは `test/` ディレクトリに `*.test.ts`、vitest で実行
- エラーは `CliError` クラスを使う（`src/errors.ts`）。`details` と `status` を持てる
- `printOutput()` で出力。`--json` フラグで machine-readable 出力に切り替わる
