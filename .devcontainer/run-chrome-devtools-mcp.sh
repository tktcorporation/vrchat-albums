#!/bin/bash
# Chrome DevTools MCP をヘッドレスモードで起動するラッパースクリプト
CHROMIUM_PATH=$(ls ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome 2>/dev/null | head -1)

exec npx -y chrome-devtools-mcp@latest \
  --headless \
  --isolated \
  "--executablePath=${CHROMIUM_PATH}" \
  --chromeArg=--no-sandbox \
  --chromeArg=--disable-setuid-sandbox
