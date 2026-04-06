# nocodb-meta-cli: `export` コマンド実装計画

## Context

現状の CLI は manifest → NocoDB の一方向（apply）のみ。既存 NocoDB スキーマを manifest JSON として書き出す `export` コマンドを追加することで、スキーマのバージョン管理・diff・マイグレーションの基盤を作る。

## スコープ

### やること

- `noco-meta export` コマンド: 指定 base のスキーマを manifest JSON として stdout or ファイルに出力
- workspace / base / tables / fields / views を manifest 形式に逆変換

### やらないこと（将来）

- `diff` コマンド（manifest と既存スキーマの差分検出）
- `migrate` コマンド（差分に基づくフィールド更新・削除）
- データの export（スキーマのみ）

## 設計

### CLI インターフェース

```bash
# 基本
noco-meta export > schema.json
noco-meta export -o schema.json

# base 指定（context の base を使うのがデフォルト）
noco-meta export --base-id <id>

# JSON pretty print（デフォルト）、compact
noco-meta export --compact

# テーブルフィルタ（任意）
noco-meta export --table "案内文,委任状"

# system フィールドを含める（デフォルトは除外）
noco-meta export --include-system
```

### 出力形式

apply で使える manifest JSON と同一形式:

```json
{
  "workspace": { "id": "ws...", "title": "..." },
  "base": { "id": "base...", "title": "..." },
  "tables": [
    {
      "title": "案内文",
      "fields": [
        { "title": "案内文名", "type": "SingleLineText", "required": true },
        { "title": "パターン", "type": "SingleSelect", "options": { "choices": [...] } },
        { "title": "使用案内文", "type": "LinkToAnotherRecord", "options": { "relationType": "hm", "relatedTable": "投函グループ" } }
      ],
      "views": [
        { "title": "Grid view", "type": "grid" }
      ]
    }
  ]
}
```

### 逆変換ロジック（NormalizedField → FieldSpec）

新規ファイル `src/export.ts` に実装:

```
NormalizedField.raw → FieldSpec
```

| raw (v2)      | FieldSpec          |
| ------------- | ------------------ |
| `uidt`        | `type`             |
| `title`       | `title`            |
| `description` | `description`      |
| `cdf`         | `defaultValue`     |
| `rqd`         | `required`         |
| `pv`          | `primary`          |
| `un`          | `unique`           |
| `colOptions`  | `options` (要変換) |

#### フィールドタイプ別の options 変換

- **SingleSelect / MultiSelect**: `raw.colOptions.options` → `options.choices`
- **DateTime**: `raw.meta.date_format` etc → `options.dateFormat` etc
- **LinkToAnotherRecord / Links**:
  - `raw.colOptions.fk_related_model_id` → テーブルID → title に解決して `options.relatedTable`
  - `raw.colOptions.type` → `options.relationType`
- **Lookup**: `raw.colOptions.fk_relation_column_id` → `options.relationField`, `raw.colOptions.fk_lookup_column_id` → `options.lookupField`
- **Rollup**: 同様 + `rollup_function`

#### システムフィールド除外

`NormalizedField.system === true` のフィールドはデフォルトで除外。`--include-system` で含める。

#### リレーションの重複排除

LinkToAnotherRecord は NocoDB が両側にフィールドを自動作成する。export 時は片側のみ出力する必要がある。
戦略: `raw.colOptions.fk_related_model_id` を見て、リレーションペアの「最初に出現した側」だけ出力。

### 実装ステップ

#### Step 1: `src/export.ts` 新規作成

主要関数:

```typescript
// メインエントリ
export async function runExport(client: NocoClient, options: ExportOptions): Promise<Manifest>;

// フィールド逆変換
function fieldToSpec(field: NormalizedField, tableIdToTitle: Map<string, string>): FieldSpec | null;

// ビュー逆変換
function viewToSpec(view: NormalizedView): ViewSpec;

// テーブル逆変換
function tableToSpec(
  table: NormalizedTable,
  tableIdToTitle: Map<string, string>,
  options: ExportOptions,
): TableSpec;
```

処理フロー:

```
1. client.listWorkspaces() → workspace 情報取得
2. client.listBases(workspaceId) → base 情報取得
3. client.listTables(baseId) → テーブル一覧
4. tableIdToTitle マップ構築（リレーション解決用）
5. 各テーブルについて:
   a. client.getTable(baseId, tableId) → フル hydrate
   b. client.listViews(baseId, tableId) → ビュー一覧
   c. fields → fieldToSpec() でフィルタ・変換
   d. views → viewToSpec() で変換
6. リレーション重複排除
7. Manifest 構造に組み立て
```

#### Step 2: `src/cli.ts` にコマンド追加

```typescript
case "export": {
  const globalConfig = await loadResolvedConfig(parsed.globals);
  requireConnectionConfig(globalConfig);
  const client = createNocoClient(globalConfig);
  await runExportCommand(client, globalConfig, parsed.commandArgs);
  return;
}
```

#### Step 3: テスト

- `test/export.test.ts`: fieldToSpec / viewToSpec / tableToSpec の単体テスト
- 実機テスト: 先ほど作った FMT自動生成 base に対して `export` → `validate` のラウンドトリップ確認

### 変更ファイル一覧

| ファイル              | 変更                               |
| --------------------- | ---------------------------------- |
| `src/export.ts`       | **新規** - export ロジック         |
| `src/cli.ts`          | コマンド追加                       |
| `src/types.ts`        | `ExportOptions` 型追加（必要なら） |
| `test/export.test.ts` | **新規** - テスト                  |
| `README.md`           | export コマンドのドキュメント追加  |

### 検証方法

```bash
# ビルド
npm run build

# ローカル NocoDB から export
node ./bin/noco-meta.js export --api-version v2 --workspace-id wsfled2f > exported.json

# validate が通ることを確認
node ./bin/noco-meta.js validate exported.json

# 別の base に apply してラウンドトリップ確認
node ./bin/noco-meta.js apply exported.json --api-version v2 --workspace-id wsfled2f --base-id <new-base-id>

# check
npm run check
```
