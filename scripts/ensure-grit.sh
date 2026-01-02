#!/bin/bash
# Ensure grit CLI is available
# Installs via official installer since @getgrit/cli is not used
# (the npm package fails in restricted network environments like Claude Code Web)

set -e

# Check if grit is already in PATH
if command -v grit &> /dev/null; then
  exit 0
fi

# Check if grit is installed in user's home directory
if [ -x "$HOME/.grit/bin/grit" ]; then
  exit 0
fi

echo "Installing grit CLI via official script..."
if curl -fsSL https://docs.grit.io/install | bash; then
  echo "grit CLI installed successfully"
else
  echo "Warning: Failed to install grit CLI. Grit-related linting will be skipped."
  echo "You can manually install grit by running: curl -fsSL https://docs.grit.io/install | bash"
  # Don't fail the install - grit is optional for development
  exit 0
fi
