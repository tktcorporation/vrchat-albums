#!/bin/bash
# Chrome DevTools MCP 動作確認スクリプト
# MCP サーバーに直接 JSON-RPC リクエストを送信してテスト

set -e

echo "🧪 Chrome DevTools MCP の動作テストを開始します..."
echo ""

# MCP サーバーを起動して初期化メッセージを送信
echo "📡 MCP サーバーへ初期化リクエストを送信..."
echo ""

# JSON-RPC リクエスト: initialize
INIT_REQUEST='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0.0"}}}'

# JSON-RPC リクエスト: tools/list (利用可能なツール一覧を取得)
LIST_TOOLS_REQUEST='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# MCP サーバーを起動してリクエストを送信
(
  echo "$INIT_REQUEST"
  sleep 1
  echo "$LIST_TOOLS_REQUEST"
  sleep 2
) | npx -y chrome-devtools-mcp@latest --headless=true --isolated=true --executablePath=/usr/bin/chromium 2>/dev/null | {

  echo "✅ MCP サーバーからの応答:"
  echo ""

  # 各行を処理
  while IFS= read -r line; do
    # JSON として整形して表示
    if echo "$line" | jq -e . >/dev/null 2>&1; then
      echo "$line" | jq '.'
      echo ""
    else
      echo "$line"
    fi
  done

} || {
  echo "❌ MCP サーバーとの通信に失敗しました"
  exit 1
}

echo ""
echo "✨ テスト完了！"
echo ""
echo "次のステップ:"
echo "1. Claude Code を再起動 (VS Code: Developer → Reload Window)"
echo "2. 再起動後、以下のようなコマンドが使用可能になります:"
echo "   - browser_navigate"
echo "   - browser_snapshot"
echo "   - browser_take_screenshot"
echo "   - browser_console_messages"
echo "   など"
echo ""
