---
'vrchat-albums': patch
---

fix(electron): 初期化が `unknown timed out` で失敗する問題を解消

Sequelize の `retry: { max: 10, timeout: 10000 }` 設定が `retry-as-promised` に渡り、クエリ実行全体に10秒の壁を作っていたため、PCスリープ復帰直後・SQLite初回アクセスのスピンアップなど正常に処理可能なクエリでも `TimeoutError: unknown timed out` で初期化が失敗するケースがあった。`retry.timeout` を撤廃し、`retry.max` を 3 に削減、`retry.name` を `'sequelize-query'` に明示。タイムアウト制御は SQLite の `busy_timeout=5000` PRAGMA と DBQueue の `timeout=60000` で代替済み。判断記録は `docs/adr/004-no-sequelize-retry-timeout.md`。
