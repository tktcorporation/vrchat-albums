---
'vrchat-albums': patch
---

fix: Rust バッチ関数を AsyncTask 化してローディング中の UI フリーズを解消

readVrcXmpBatch と readImageDimensionsBatch が同期的な N-API 呼び出しだったため、
Rayon 並列処理中にメインスレッドがブロックされ UI がフリーズしていた問題を修正。

- napi-rs の AsyncTask で libuv スレッドプール上で処理を実行し、メインスレッドを非ブロック化
- XMP ストリーミングリーダーに BufReader(64KB) を追加して syscall 数を大幅削減
