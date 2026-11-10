# ADR-007: DB は処理本体で同期ドライバ（node:sqlite）から使い、クエリの再試行を持たない

- **ステータス**: accepted
- **日付**: 2026-11-09
- **関連コード**: `electron/lib/db/client.ts`, `electron/lib/dbQueue.ts`
- **関連ルール**: `.claude/rules/project/electron-import.md`（main は DB の層を読み込まない）
- **置き換える ADR**: [ADR-004](./004-no-sequelize-retry-timeout.md)

## コンテキスト

DB の層は Drizzle ORM と Node 組み込みの `node:sqlite`（`drizzle-orm/node-sqlite`）で組む。`node:sqlite` はクエリを呼び出したスレッドで同期的に実行し、ライブラリの側にクエリの再試行や壁時間の仕組みを持たない。

同期ドライバはクエリの間、呼び出したプロセスのイベントループを止める。DB を開くのは処理本体（`electron/backend/main.ts` が起動する utilityProcess）だけなので、止まるのは処理本体で、画面と main プロセスは止まらない。

## 決定

- DB は処理本体だけが開く。main プロセスは DB の層（`electron/lib/db/`・`drizzle-orm`・`node:sqlite`）を読み込まない
- クエリの再試行と、クエリ単位の壁時間は持たない
- ロックの待ちは SQLite の `busy_timeout=5000` PRAGMA、タスク全体の上限は `DBQueue` の `timeout`（書き込みは 60 秒、読み取りは 20 秒）が受け持つ
- トランザクションのコールバックは同期で書く。ファイルの読み込みなどの非同期の処理は、トランザクションの前か後で行う（`DBQueue.transaction` の JSDoc）

## 根拠

- **再試行が要る失敗が起きにくい**: SQLite は単一プロセスの DB で、アプリの接続は処理本体の 1 本だけ。`DBQueue` の書き込みキューが `concurrency: 1` で直列化するので、同じプロセスの中で書き込みどうしがロックを奪い合わない。別のプロセス（DB を開いたままの外部ツールなど）がロックを持つ場合は `busy_timeout` が待つ
- **同期のトランザクションは途中に await を挟めない**: 同期ドライバのトランザクションは、コールバックが Promise を返した時点で COMMIT される。後から投げても巻き戻らないので、コールバックを同期に限ることで、巻き戻しの範囲をコードの見た目と一致させる
- **画面を止めない**: 同期の実行が止めるのは処理本体のイベントループだけになる。CPU を使う処理を main プロセスから外す方針（ADR-005）と同じ線引きにそろう

## 結果

- 長いクエリやマイグレーションの間、処理本体の tRPC の応答と進捗の送信が止まる。ログの一括登録の進捗は、トランザクションのコミットの後にまとめて届く
- DB のエラーは `node:sqlite` のエラー（拡張エラーコードの `errcode`）を Drizzle が `cause` に包んだ形で届く。`DBQueue` はこれを `SQLITE_BUSY` などの名前にして Sentry のタグに載せる

## 反証条件（ADR を見直すべき状況）

- DB を処理本体以外のプロセス（main プロセス・画面）から開く必要が出た場合
- `DBQueue` を撤廃する場合、または書き込みを `concurrency > 1` で並走させる場合
- 処理本体の停止が tRPC の応答時間として問題になる長さのクエリが常態化した場合（DB の処理を worker thread へ移す）
