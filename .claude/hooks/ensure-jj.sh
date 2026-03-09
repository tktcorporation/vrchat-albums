#!/bin/bash
# Hook: セッション開始時に jj がインストールされていることを確認する
# SessionStart hook

set -euo pipefail

# 1. PATH に jj があればOK
if command -v jj &>/dev/null; then
  exit 0
fi

# 2. mise 経由でインストールを試みる
if command -v mise &>/dev/null; then
  echo "jj が見つかりません。mise 経由でインストールします..."
  if mise install jj 2>/dev/null; then
    eval "$(mise activate bash 2>/dev/null)" || true
    if command -v jj &>/dev/null; then
      echo "jj $(jj --version) をインストールしました"
      exit 0
    fi
  fi
fi

# 3. GitHub リリースからダウンロード
echo "mise でのインストールに失敗しました。GitHub から直接ダウンロードします..."

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "${OS}-${ARCH}" in
  linux-x86_64)  TARGET="x86_64-unknown-linux-musl" ;;
  linux-aarch64) TARGET="aarch64-unknown-linux-musl" ;;
  darwin-x86_64) TARGET="x86_64-apple-darwin" ;;
  darwin-arm64)  TARGET="aarch64-apple-darwin" ;;
  *)
    echo "警告: サポートされていないプラットフォーム (${OS}-${ARCH})"
    echo "手動でインストールしてください: https://jj-vcs.github.io/jj/latest/install-and-setup/"
    exit 0
    ;;
esac

LATEST_TAG=$(curl -fsSL "https://api.github.com/repos/jj-vcs/jj/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST_TAG" ]; then
  echo "警告: 最新バージョンの取得に失敗しました"
  echo "手動でインストールしてください: https://jj-vcs.github.io/jj/latest/install-and-setup/"
  exit 0
fi

DOWNLOAD_URL="https://github.com/jj-vcs/jj/releases/download/${LATEST_TAG}/jj-${LATEST_TAG}-${TARGET}.tar.gz"
INSTALL_DIR="${HOME}/bin"

mkdir -p "$INSTALL_DIR"

if curl -fsSL "$DOWNLOAD_URL" | tar xz -C "$INSTALL_DIR" jj 2>/dev/null; then
  chmod +x "${INSTALL_DIR}/jj"
  export PATH="${INSTALL_DIR}:${PATH}"
  echo "jj ${LATEST_TAG} を ${INSTALL_DIR} にインストールしました"
else
  echo "警告: jj のダウンロードに失敗しました"
  echo "手動でインストールしてください: https://jj-vcs.github.io/jj/latest/install-and-setup/"
fi

exit 0
