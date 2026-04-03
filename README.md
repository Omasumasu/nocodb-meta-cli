# nocodb-meta-cli

NocoDB の `meta` API を CLI から扱うための TypeScript 製ツールです。  
GUI でベースやテーブルを組み立てるのが大変なときに、JSON manifest を元に `workspace / base / table / field / view` をまとめて作れるようにしています。

`v2` と `v3` は `--api-version` で切り替えられます。

## できること

- `init`: profile 作成、secure token 保存、project context 初期化
- `profile`: profile の追加・一覧・切り替え・削除
- `auth`: token の登録・削除・状態確認
- `context`: project ごとの profile / workspace / base 上書き管理
- `doctor`: 設定、secure store、疎通確認
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
- test: `vitest`
- lint: `oxlint`
- format: `oxfmt`
- typecheck: `tsc --noEmit`
- dead code / unused deps: `knip`

まとめて確認:

```bash
npm run check
```

## 認証設定

ローカル利用では、まず `init` を実行します。

```bash
node ./bin/noco-meta.js init
```

`init` は次を行います。

- profile 名の作成
- `baseUrl` と `apiVersion` の保存
- `xc-token` の secure storage 保存
- 既定 `workspaceId` / `baseId` の保存
- 現在の project に対する active profile 設定

現在の実装では token は OS の secure store に保存します。

- macOS: Keychain
- Linux: `secret-tool` が使える場合は Secret Service
- それ以外の環境では local secure store 未対応

project 固有の context は `.noco-meta/context.json` に保存されます。  
このディレクトリは `.gitignore` に入っています。

CI や非対話実行では env で bypass できます。

```bash
export NOCODB_BASE_URL="https://your-nocodb.example.com"
export NOCODB_TOKEN="your-xc-token"
export NOCODB_API_VERSION="v3"
```

必要に応じて:

```bash
export NOCODB_WORKSPACE_ID="ws_xxx"
export NOCODB_BASE_ID="base_xxx"
```

補足:

- `--base-url` / `--token` だけでは通常利用できません
- local 利用は `init` 済み profile 前提です
- env は CI / automation 用の bypass と考えてください
- 旧 `.nocodb-meta-cli.json` は `init` の初期値補助としてだけ見ています

## 使い方

初期化:

```bash
node ./bin/noco-meta.js init
node ./bin/noco-meta.js doctor
```

profile 一覧と切り替え:

```bash
node ./bin/noco-meta.js profile ls
node ./bin/noco-meta.js profile use dev
node ./bin/noco-meta.js auth status dev
node ./bin/noco-meta.js context show
```

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
node ./bin/noco-meta.js request GET /meta/workspaces
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
