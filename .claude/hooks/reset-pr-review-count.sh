#!/usr/bin/env bash
# PostToolUse フック: gh pr create 成功後にセルフレビューカウンターをリセットする。
#
# PreToolUse でリセットすると、PR作成が失敗・キャンセルされた場合に
# レビュー回数がリセットされてしまい、再度2回のレビューが必要になる。
# PostToolUse で成功後のみリセットすることでこの問題を防ぐ。

set -euo pipefail

INPUT="${CLAUDE_TOOL_INPUT:-}"

# gh pr create 以外は無視
if ! printf '%s' "$INPUT" | grep -qE 'gh\s+pr\s+create'; then
  exit 0
fi

REVIEW_COUNT_FILE="${CLAUDE_PROJECT_DIR:-.}/.claude/.pr-review-count"
rm -f "$REVIEW_COUNT_FILE"
exit 0
