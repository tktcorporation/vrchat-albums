#!/usr/bin/env bash
set -euo pipefail

# changesets は pnpm-workspace.yaml が存在すると monorepo モードで動作し、
# ルートパッケージを packages リストに含めないため version コマンドが失敗する。
# workspace 設定を一時退避して single-package モードで実行する。

WORKSPACE_FILE="pnpm-workspace.yaml"
PACKAGE_JSON="package.json"

cleanup() {
  # pnpm-workspace.yaml を復元
  if [ -f "${WORKSPACE_FILE}.bak" ]; then
    mv "${WORKSPACE_FILE}.bak" "$WORKSPACE_FILE"
  fi
  # package.json の workspaces フィールドを復元
  if [ -f "${PACKAGE_JSON}.bak" ]; then
    mv "${PACKAGE_JSON}.bak" "$PACKAGE_JSON"
  fi
}
trap cleanup EXIT

# pnpm-workspace.yaml を退避
if [ -f "$WORKSPACE_FILE" ]; then
  mv "$WORKSPACE_FILE" "${WORKSPACE_FILE}.bak"
fi

# package.json から workspaces フィールドを一時削除
if node -e "process.exit(require('./${PACKAGE_JSON}').workspaces ? 0 : 1)" 2>/dev/null; then
  cp "$PACKAGE_JSON" "${PACKAGE_JSON}.bak"
  node -e "
    const pkg = require('./${PACKAGE_JSON}');
    delete pkg.workspaces;
    require('fs').writeFileSync('${PACKAGE_JSON}', JSON.stringify(pkg, null, 2) + '\n');
  "
fi

pnpm exec changeset version
