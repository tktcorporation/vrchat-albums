#!/usr/bin/env bash
# セルフレビュー完了を記録するスクリプト。
# codex review 実行後に呼び出し、.claude/.pr-review-count をインクリメントする。
#
# 使い方:
#   bash .claude/hooks/record-pr-review.sh
#
# Claude が自動的に呼び出す（require-pr-self-review.sh の指示に従って）

set -euo pipefail

REVIEW_COUNT_FILE="${CLAUDE_PROJECT_DIR:-.}/.claude/.pr-review-count"

count=0
if [[ -f "$REVIEW_COUNT_FILE" ]]; then
  count=$(cat "$REVIEW_COUNT_FILE" 2>/dev/null || echo 0)
  if ! [[ "$count" =~ ^[0-9]+$ ]]; then
    count=0
  fi
fi

new_count=$((count + 1))
echo "$new_count" > "$REVIEW_COUNT_FILE"

echo "セルフレビュー ${new_count} 回目を記録しました。"
