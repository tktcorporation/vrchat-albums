#!/bin/bash
# Chrome DevTools MCP セットアップスクリプト
# DevContainer 環境で Chrome/Chromium をインストールし、Chrome DevTools MCP を利用可能にする

set -e

echo "🚀 Chrome DevTools MCP セットアップを開始します..."

# Playwright と Chromium のインストール
echo "📦 Playwright 経由で Chromium をインストールしています..."
mise install > /dev/null 2>&1
mise run playwright-install 2>&1 | grep -v "WARNING" | grep -v "npm install" || true
echo "✅ Playwright Chromium のインストールが完了しました"

# システム依存関係のインストール (Playwright公式コマンド使用)
echo "📦 システム依存関係をインストールしています..."
echo "   (Playwright Chromium の実行に必要なライブラリ)"
if command -v npx &> /dev/null; then
    # npxが利用可能な場合はPlaywright公式のinstall-depsを使用
    sudo npx -y playwright install-deps chromium > /dev/null 2>&1 || {
        echo "⚠️  playwright install-deps が失敗しました。手動で依存関係をインストールします..."
        sudo apt-get update -qq
        sudo apt-get install -y -qq \
            libglib2.0-0 libnspr4 libnss3 libdbus-1-3 \
            libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcb1 \
            libxkbcommon0 libatspi2.0-0 libx11-6 libxcomposite1 \
            libxdamage1 libxext6 libxfixes3 libxrandr2 \
            libgbm1 libcairo2 libpango-1.0-0 libasound2 \
            > /dev/null 2>&1
    }
else
    # npxが利用不可能な場合は手動でインストール
    sudo apt-get update -qq
    sudo apt-get install -y -qq \
        libglib2.0-0 libnspr4 libnss3 libdbus-1-3 \
        libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcb1 \
        libxkbcommon0 libatspi2.0-0 libx11-6 libxcomposite1 \
        libxdamage1 libxext6 libxfixes3 libxrandr2 \
        libgbm1 libcairo2 libpango-1.0-0 libasound2 \
        > /dev/null 2>&1
fi
echo "✅ システム依存関係のインストールが完了しました"

# Chrome のバージョン確認
PLAYWRIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium-*/chrome-linux/chrome"
if ls $PLAYWRIGHT_CHROMIUM 1> /dev/null 2>&1; then
    CHROME_PATH=$(ls $PLAYWRIGHT_CHROMIUM | head -1)
    CHROME_VERSION=$($CHROME_PATH --version 2>/dev/null || echo "バージョン不明")
    echo "📌 Playwright Chromium バージョン: $CHROME_VERSION"
    echo "📌 Chromium パス: $CHROME_PATH"
fi

# Node.js のバージョン確認
NODE_VERSION=$(node --version)
echo "📌 Node.js バージョン: $NODE_VERSION"

# Chrome DevTools MCP のインストール確認
echo "🔍 Chrome DevTools MCP の動作確認..."
if npx -y chrome-devtools-mcp@latest --help &> /dev/null; then
    echo "✅ Chrome DevTools MCP が正常に動作します"
else
    echo "⚠️  Chrome DevTools MCP の実行に問題がある可能性があります"
fi

echo ""
echo "✨ セットアップが完了しました！"
echo ""
echo "次のステップ:"
echo "1. Claude Code を再起動して MCP サーバーを読み込む"
echo "   (VS Code コマンドパレット > 'Developer: Reload Window')"
echo "2. Chrome DevTools MCP ツールが利用可能になります"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "📖 Chrome DevTools MCP の使い方"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "【基本操作】"
echo "  # ページへ移動"
echo "  mcp__chrome-devtools__navigate_page を使用して http://localhost:8000 にアクセス"
echo ""
echo "  # ページ構造を取得（推奨: スクリーンショットより軽量）"
echo "  mcp__chrome-devtools__take_snapshot"
echo ""
echo "  # スクリーンショットを撮影"
echo "  mcp__chrome-devtools__take_screenshot"
echo ""
echo "  # ネットワークリクエストを確認"
echo "  mcp__chrome-devtools__list_network_requests"
echo ""
echo "【開発フローでの活用】"
echo "  1. ローカルサーバーを起動（例: cd repo/lapras && docker compose up -d）"
echo "  2. Claude Code で「localhost:8000 の動作を確認」と指示"
echo "  3. 自動的にページアクセス、構造解析、スクリーンショット撮影"
echo "  4. エラーやネットワーク問題をデバッグ"
echo ""
echo "【利用可能なツール】"
echo "  - ナビゲーション: navigate_page, navigate_back, tabs"
echo "  - ページ分析: snapshot, screenshot, network_requests"
echo "  - インタラクション: click, type, fill_form, select_option"
echo "  - デバッグ: evaluate (JavaScript実行), wait_for"
echo "  - パフォーマンス: performance_start_trace, performance_stop_trace"
echo ""
echo "詳細は .devcontainer/CHROME_DEVTOOLS_MCP.md を参照してください"
echo "═══════════════════════════════════════════════════════════════"
echo ""
