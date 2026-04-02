# nocodb-meta-cli

NocoDB の `meta` API を CLI から扱うための TypeScript 製ツールです。  
GUI でベースやテーブルを組み立てるのが大変なときに、JSON manifest を元に `workspace / base / table / field / view` をまとめて作れるようにしています。

`v2` と `v3` は `--api-version` で切り替えられます。

## できること

- `request`: `meta` API への低レベルな直接呼び出し
- `template manifest`: manifest 雛形の生成
- `validate`: manifest の静的検証
- `plan`: 実行前プラン確認
- `apply`: manifest ベースの作成・追記

## セットアップ

```bash
npm install
npm run build
```

## Tooling

- build: `vite`
- lint: `oxlint`
- format: `oxfmt`
- typecheck: `tsc --noEmit`
- tests: `tsx --test`
- dead code / unused deps: `knip`

まとめて確認:

```bash
npm run check
```

## 認証設定

環境変数:

```bash
export NOCODB_BASE_URL="https://your-nocodb.example.com"
export NOCODB_TOKEN="your-xc-token"
export NOCODB_API_VERSION="v3"
```

またはルートに `.nocodb-meta-cli.json` を置けます。

```json
{
  "baseUrl": "https://your-nocodb.example.com",
  "token": "your-xc-token",
  "apiVersion": "v3",
  "workspaceId": "ws_xxx"
}
```

## 使い方

manifest 雛形を出す:

```bash
node ./bin/noco-meta.js template manifest
```

検証:

```bash
node ./bin/noco-meta.js validate ./examples/crm.json
```

Dry run:

```bash
node ./bin/noco-meta.js plan ./examples/crm.json --api-version v3
```

適用:

```bash
node ./bin/noco-meta.js apply ./examples/crm.json --api-version v3
```

低レベル request:

```bash
node ./bin/noco-meta.js request GET /meta/workspaces --api-version v3
node ./bin/noco-meta.js request POST /meta/bases/{baseId}/tables --body @payload.json --api-version v2
```

## Manifest 例

[`examples/crm.json`](./examples/crm.json)

```json
{
  "workspace": {
    "title": "AI Schema Playground"
  },
  "base": {
    "title": "CRM"
  },
  "tables": [
    {
      "title": "Companies",
      "fields": [
        {
          "title": "Name",
          "type": "SingleLineText",
          "required": true
        }
      ]
    },
    {
      "title": "Contacts",
      "fields": [
        {
          "title": "Full Name",
          "type": "SingleLineText"
        },
        {
          "title": "Company",
          "type": "LinkToAnotherRecord",
          "options": {
            "relationType": "hm",
            "relatedTable": "Companies"
          }
        }
      ]
    }
  ]
}
```

## Manifest の考え方

- `workspace`, `base`, `tables[]` を宣言的に書きます
- フィールドは `type` に NocoDB の型名を使います
- リレーションは `relatedTable` を使って他テーブル参照できます
- 共通抽象化で足りないときは各ノードに `api.common`, `api.v2`, `api.v3` を置いて生 payload を上書きできます

例:

```json
{
  "title": "Status",
  "type": "SingleSelect",
  "options": {
    "choices": [
      { "title": "Todo", "color": "#36BFFF" },
      { "title": "Done", "color": "#2ECC71" }
    ]
  },
  "api": {
    "v2": {
      "colOptions": {
        "options": [
          { "title": "Todo", "color": "#36BFFF" },
          { "title": "Done", "color": "#2ECC71" }
        ]
      }
    }
  }
}
```

## v2 / v3 メモ

- `v3` は workspace 前提です
- `v2` は一部の advanced view 設定や細かい field option で生 payload の上書きが必要になることがあります
- 既存 view の sorts / filters の完全同期はまだ未対応です
- その場合は `request` コマンドで直接叩く想定です

## Skill

Codex 用 Skill は [`skills/nocodb-meta-builder`](./skills/nocodb-meta-builder) に置いてあります。  
この repo の CLI を使って、ER 図やスキーマ仕様から NocoDB 環境を組み立てるための薄い運用ガイドです。
