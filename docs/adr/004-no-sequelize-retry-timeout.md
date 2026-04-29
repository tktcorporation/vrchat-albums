# ADR-004: Sequelize の retry.timeout を使用しない

- **ステータス**: accepted
- **日付**: 2026-04-29
- **関連コード**: `electron/lib/sequelize.ts`
- **関連ルール**: なし（コード内コメントで強制）

## コンテキスト

Sequelize の `retry` オプションは内部で `retry-as-promised` パッケージに渡される。`timeout` を指定すると、リトライを含む**クエリ全体**に壁時間が設定され、超過すると `TimeoutError: <name> timed out` を throw する。

旧設定 `retry: { max: 10, timeout: 10000 }` では、PCスリープ復帰直後・SQLite初回アクセスのスピンアップ・大量ログ初期化など、**正常に処理可能なクエリでも10秒を超えると即失敗**する事象が発生していた。

実例（本番ログ）:

- `start log filtering: 10 logs` から **ちょうど10秒後** に `TimeoutError: unknown timed out` でアプリ初期化失敗
- 同じクエリは別タイミングで 3,731ms かけて成功している

`timeout` 未指定でも DB アクセスが無限ハングしない根拠:

1. SQLite は単プロセス DB のため、DB レベルでの長時間ロック競合は構造的に発生しにくい
2. `busy_timeout=5000` PRAGMA で SQLite のロック待ちは最大5秒
3. `DBQueue` の PQueue が `timeout=60000` でタスク全体に60秒の壁を持つ
4. アプリ内の DB 同時実行は `concurrency: 1` で直列化されている

ただし、3 の DBQueue による保護は DBQueue 経由のタスクのみに効く。
**接続確立時の `authenticate` および `configureSQLitePragmas` 内の `client.query(...)` は DBQueue を経由しない**ため、これらが詰まった場合はプロセス全体のハング検知（OS / Electron 側）に依存する。

## 決定

- `Sequelize.options.retry.timeout` は**指定しない**
- `Sequelize.options.retry.max` は SQLITE_BUSY 等の一過性エラー回復のため `3` に絞る
- `Sequelize.options.retry.name` は `'sequelize-query'` を明示する（診断容易性）

## 根拠

- **正しい責務分離**: 「クエリ単体の最大実行時間」は SQLite/DBQueue の責務。`retry-as-promised` は本来「失敗時の再試行回数制御」のためのもので、壁時間を被せる用途ではない
- **回復可能な状態を失敗にしない**: SQLite の遅延は環境要因（ディスクスピンアップ、スリープ復帰）で発生しうる正常状態。これを失敗扱いするのは堅牢性に反する
- **多重リトライの抑制**: 上位（Effect）でリトライを足す将来計画があるため、`max=10` のような大きな値は待機時間爆発の温床

## 許容される例外

- なし。テスト用クライアント (`__initTestRDBClient`) も `_newRDBClient` を経由するため自動的に同じ `retry` 設定が適用される
- 不変条件は `electron/lib/sequelize.integration.test.ts` のテストで機械的に保証する

## 結果

- `unknown timed out` エラーの根本原因を除去
- エラー文言は `sequelize-query timed out`（発生時のみ）になり、Sentry での集約と原因特定が容易になる
- 将来的に上位レイヤで `Effect.retry` を追加する場合、二重リトライの待機時間が予測可能になる

## 反証条件（ADR を見直すべき状況）

- SQLite 以外の dialect を採用する場合（Postgres/MySQL ではネットワーク起因のハングがあり得る）
- DBQueue を撤廃する場合
- `concurrency > 1` で複数クエリを並走させる場合
