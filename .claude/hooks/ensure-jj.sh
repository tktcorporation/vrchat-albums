#!/bin/bash
# Claude Code hook: Ensure jj is installed via mise at session start
#
# Runs on SessionStart to install jj if not already available.

if command -v mise &>/dev/null; then
  mise install jj 2>/dev/null
  # Verify installation
  if mise which jj &>/dev/null; then
    echo "jj is ready ($(mise which jj))" >&2
  else
    echo "Warning: mise install jj failed" >&2
  fi
else
  echo "Warning: mise not found. Install jj manually or install mise first." >&2
fi

exit 0
