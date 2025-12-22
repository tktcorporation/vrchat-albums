#!/bin/bash
# Chrome DevTools MCP セットアップスクリプト
set -e

echo "mise のセットアップ状況を確認中..."
mise list

# Node.js のバージョン確認
NODE_VERSION=$(mise exec -- node --version)
echo "📌 Node.js バージョン: $NODE_VERSION"

echo "🚀 Chrome DevTools MCP セットアップ..."

# システム依存関係のインストール
echo "📦 システム依存関係をインストール中..."
mise exec -- npx -y playwright install-deps chromium

# Playwright Chromium のインストール
echo "📦 Chromium をインストール中..."
mise exec -- npx -y playwright install chromium

# 確認
CHROME_PATH=$(ls ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome 2>/dev/null | head -1)
echo "✅ セットアップ完了: $CHROME_PATH"

# Chrome DevTools MCP のインストール確認
echo "🔍 Chrome DevTools MCP の動作確認..."
if mise exec -- npx -y chrome-devtools-mcp@latest --help &> /dev/null; then
    echo "✅ Chrome DevTools MCP が正常に動作します"
else
    echo "⚠️  Chrome DevTools MCP の実行に問題がある可能性があります"
fi
