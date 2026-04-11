#!/bin/bash
# Chrome DevTools MCP をヘッドレスモードで起動するラッパースクリプト
#
# Claude Code セッション終了時に Chrome プロセスが残留する問題への対策:
# - 起動前に前セッションの孤児 Chrome を掃除
# - trap で自プロセス終了時にも子 Chrome を確実に kill
CHROMIUM_PATH=$(ls ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome 2>/dev/null | head -1)
USER_DATA_DIR="/tmp/puppeteer_dev_chrome_profile-cdp-mcp"

# 前セッションの孤児 Chrome を掃除
# user-data-dir で自分が起動した Chrome だけを対象にする
cleanup_chrome() {
  pkill -f "chrome.*--user-data-dir=${USER_DATA_DIR}" 2>/dev/null || true
  # crashpad_handler も残るので掃除
  pkill -f "chrome_crashpad_handler.*${USER_DATA_DIR}" 2>/dev/null || true
}

cleanup_chrome

# 終了時に子プロセスツリーごと掃除
trap 'cleanup_chrome; exit 0' EXIT INT TERM

npx -y chrome-devtools-mcp@latest \
  --headless \
  --isolated \
  "--executablePath=${CHROMIUM_PATH}" \
  --chromeArg=--no-sandbox \
  --chromeArg=--disable-setuid-sandbox \
  "--chromeArg=--user-data-dir=${USER_DATA_DIR}"
