#!/usr/bin/env bash
# gh pr create を実行する前にセルフレビューを2回要求するフック。
#
# 仕組み:
#   .claude/.pr-review-count にレビュー完了回数を記録する。
#   2回未満なら gh pr create をブロックし、Claude にレビューを指示する。
#   2回以上なら通過させ、PR作成後にカウンターをリセットする。
#
# カウンターの操作:
#   インクリメント: .claude/hooks/record-pr-review.sh
#   リセット: このスクリプトが通過を許可した時点で自動リセット

set -euo pipefail

REVIEW_COUNT_FILE="${CLAUDE_PROJECT_DIR:-.}/.claude/.pr-review-count"
REQUIRED_REVIEWS=2

# カウンターファイルが無ければ 0
count=0
if [[ -f "$REVIEW_COUNT_FILE" ]]; then
  count=$(cat "$REVIEW_COUNT_FILE" 2>/dev/null || echo 0)
  # 数値でない場合のフォールバック
  if ! [[ "$count" =~ ^[0-9]+$ ]]; then
    count=0
  fi
fi

if [[ "$count" -lt "$REQUIRED_REVIEWS" ]]; then
  remaining=$((REQUIRED_REVIEWS - count))
  cat <<DENY_JSON
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "PR作成をブロックしました。セルフレビューがあと${remaining}回必要です（現在 ${count}/${REQUIRED_REVIEWS} 回完了）。次の手順を実行してください: 1) codex review --uncommitted を Bash で実行してレビュー結果を確認する 2) 指摘事項があれば修正する 3) .claude/hooks/record-pr-review.sh を実行してレビュー完了を記録する 4) 必要回数に達するまで 1-3 を繰り返す 5) 再度 gh pr create を試みる"
  }
}
DENY_JSON
  exit 0
fi

# レビュー完了済み — PR作成を許可し、カウンターをリセット
rm -f "$REVIEW_COUNT_FILE"
exit 0
