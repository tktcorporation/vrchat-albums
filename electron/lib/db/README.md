# DB の層

処理本体（utilityProcess）が開く SQLite の DB を、Drizzle ORM と Node 組み込みの `node:sqlite` で扱う。同期ドライバを処理本体だけで使う理由は [ADR-007](../../../docs/adr/007-sync-sqlite-driver-in-backend.md)。

| ファイル            | 役割                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `schema.ts`         | テーブル定義。マイグレーションの生成元                                                         |
| `utcDateTime.ts`    | 日時の列の型。保存形式は `.claude/rules/project/timezone.md`                                   |
| `client.ts`         | DB を開く・閉じる・マイグレーションを適用する入口と、テスト用の DB                             |
| `migrations/`       | drizzle-kit が生成したマイグレーション。処理本体のバンドルへ埋め込む（`migrations.ts`）        |
| `migrate.ts`        | 起動時の初期化（`settingsController` の Step 1）から呼ばれ、未適用のマイグレーションを適用する |
| `legacyTakeover.ts` | Sequelize が作った DB を、複製してから Drizzle の管理下へ引き継ぐ                              |

## テーブル定義を変える

1. `schema.ts` を変える
2. `pnpm db:generate --name <変更を表す名前>` でマイグレーションを生成する。`migrations/<日時>_<名前>/` に `migration.sql` と `snapshot.json` ができる
3. `migration.sql` を読む。列の型の変更などでテーブルを作り直す SQL が生成されたときは、既存の行の値を新しい型へ移す SQL が正しいか確かめ、必要なら手で直す
4. `pnpm test` で、既存の DB を引き継ぐテスト（`migrate.test.ts`）を含めて確かめる

`pnpm lint` の `lint:custom` が `scripts/check-db-migrations.ts` を実行し、`schema.ts` を変えたのにマイグレーションを生成していないと失敗する。

## 守ること

- 一度リリースしたマイグレーションのフォルダの名前と中身は変えない。適用済みかどうかはフォルダの名前で判定するので、名前を変えると同じ変更をもう一度適用しようとする
- 最初のマイグレーション（`*_baseline`）は、Sequelize の時代の DB を引き継ぐときの基準になる。中身を変えない
- テーブル・列・インデックスの名前は既存の DB と同じにする（`schema.ts` の JSDoc）
