#!/bin/bash
# Claude Code hook: Ensure jj is installed at session start
#
# Priority:
#   1. mise install jj (if mise available)
#   2. Direct binary download from GitHub releases (fallback)

JJ_INSTALL_DIR="$HOME/bin"

# Already available in PATH -> done
if command -v jj &>/dev/null; then
  echo "jj is ready ($(command -v jj))" >&2
  exit 0
fi

# Try mise first
if command -v mise &>/dev/null; then
  mise install jj 2>/dev/null
  if command -v jj &>/dev/null; then
    echo "jj installed via mise ($(command -v jj))" >&2
    exit 0
  fi
fi

# Fallback: download binary from GitHub releases
echo "Installing jj from GitHub releases..." >&2

ARCH="$(uname -m)"
OS="$(uname -s)"

case "${OS}-${ARCH}" in
  Linux-x86_64)  TARGET="x86_64-unknown-linux-musl" ;;
  Linux-aarch64) TARGET="aarch64-unknown-linux-musl" ;;
  Darwin-x86_64) TARGET="x86_64-apple-darwin" ;;
  Darwin-arm64)  TARGET="aarch64-apple-darwin" ;;
  *)
    echo "Warning: Unsupported platform ${OS}-${ARCH}. Install jj manually: https://jj-vcs.github.io/jj/latest/install-and-setup/" >&2
    exit 0
    ;;
esac

# Get latest version tag
LATEST_TAG=$(curl -fsSL "https://api.github.com/repos/jj-vcs/jj/releases/latest" 2>/dev/null | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
if [ -z "$LATEST_TAG" ]; then
  echo "Warning: Could not fetch latest jj version. Install jj manually: https://jj-vcs.github.io/jj/latest/install-and-setup/" >&2
  exit 0
fi

URL="https://github.com/jj-vcs/jj/releases/download/${LATEST_TAG}/jj-${LATEST_TAG}-${TARGET}.tar.gz"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

if curl -fsSL "$URL" -o "$TMP_DIR/jj.tar.gz" 2>/dev/null; then
  tar xzf "$TMP_DIR/jj.tar.gz" -C "$TMP_DIR" 2>/dev/null
  if [ -f "$TMP_DIR/jj" ]; then
    mkdir -p "$JJ_INSTALL_DIR"
    mv "$TMP_DIR/jj" "$JJ_INSTALL_DIR/jj"
    chmod +x "$JJ_INSTALL_DIR/jj"
    export PATH="$JJ_INSTALL_DIR:$PATH"
    echo "jj ${LATEST_TAG} installed to ${JJ_INSTALL_DIR}/jj" >&2
    exit 0
  fi
fi

echo "Warning: Failed to install jj. Install manually: https://jj-vcs.github.io/jj/latest/install-and-setup/" >&2
exit 0
