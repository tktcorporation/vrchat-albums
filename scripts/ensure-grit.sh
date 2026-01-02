#!/bin/bash
# Ensure grit CLI is available
# Falls back to official installer if @getgrit/cli failed

if command -v grit &> /dev/null; then
  exit 0
fi

if [ -x "$HOME/.grit/bin/grit" ]; then
  exit 0
fi

# Check if node_modules grit works
if node_modules/.bin/grit --version &> /dev/null; then
  exit 0
fi

echo "Installing grit CLI via official script..."
curl -fsSL https://docs.grit.io/install | bash
