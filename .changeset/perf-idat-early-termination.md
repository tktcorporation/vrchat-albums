---
'vrchat-albums': patch
---

perf: PNG XMP 抽出で IDAT 到達時に走査を打ち切り、フルロードを高速化

VRChat 写真 (16MB, ~1975 IDAT チャンク) のメタデータ抽出で IDAT 以降を
全走査していた問題を修正。IDAT 到達で打ち切ることで膨大な I/O を回避。
