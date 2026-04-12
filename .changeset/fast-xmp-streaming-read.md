---
'vrchat-albums': patch
---

perf: XMP メタデータ抽出を部分読み込み + バッチ一発呼びで高速化

従来はファイル全体を `fs::read` で読み込み、1ファイルずつ N-API 経由で呼んでいたが、
Rust 側で部分読み込み（JPEG: APP1 マーカースキャン、PNG: iTXt チャンクヘッダー走査）+
Rayon 全コア並列のバッチ関数に切り替え。

- 新規: `packages/exif-native/src/xmp/streaming_reader.rs` (Rust テスト10件含む)
- 変更: `read_vrc_xmp` / `read_vrc_xmp_batch` を部分読み込み版に置き換え
- 変更: `service.ts` を `readXmpTagsBatch` 一発呼びに簡略化
- 削除: `parsePhotoMetadataBatch` のループ処理（Rust バッチで不要に）
