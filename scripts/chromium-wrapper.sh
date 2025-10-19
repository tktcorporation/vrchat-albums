#!/bin/bash
# Chromium wrapper script for Chrome DevTools MCP
# Finds and executes Playwright Chromium

# Find the Chromium executable in Playwright cache
CHROMIUM_PATH=$(find ~/.cache/ms-playwright -name "chrome" -path "*/chrome-linux/chrome" -type f 2>/dev/null | head -1)

if [ -z "$CHROMIUM_PATH" ]; then
    echo "Error: Playwright Chromium not found. Please run: npx playwright install chromium" >&2
    exit 1
fi

# Execute Chromium with all passed arguments
exec "$CHROMIUM_PATH" "$@"
