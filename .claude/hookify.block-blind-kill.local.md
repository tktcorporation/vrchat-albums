---
name: block-blind-kill
enabled: true
event: bash
pattern: (kill\s+%\d|lsof\s+-i\s+.*\|\s*xargs.*kill|kill\s+-9?\s+\$\(|pkill\s+-f)
action: block
---

🚫 **VSCode プロセスを巻き込む可能性のある kill コマンドがブロックされました**

以下のパターンは VSCode のプロセスを誤って kill する危険があるため禁止されています:

- `kill %N` — バックグラウンドジョブの無差別 kill
- `lsof -i :PORT | xargs kill` — ポート指定での無差別 kill（VSCode がそのポートを使用している場合がある）
- `kill -9 $(...)` — コマンド置換による無差別 kill
- `pkill -f` — プロセス名パターンでの無差別 kill

**代わりに以下の安全な方法を使ってください:**

1. まず `lsof -i :PORT` でプロセスを確認し、VSCode 関連でないことを確認
2. 特定の PID を指定して `kill <PID>` を実行
3. 自分が起動したプロセスのみを対象にする
