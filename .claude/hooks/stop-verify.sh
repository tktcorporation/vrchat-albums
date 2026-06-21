#!/usr/bin/env bash
# Stop framework hook: 完了宣言の前に project の mise task に委譲して
# 全体検証（lint/test/型チェック等）を実行し、違反があればエージェントに差し戻す。
#
# 責務分離:
#   - このスクリプト（汎用、ziku 同期対象）: mise 委譲 → JSON 整形
#   - project の `.mise/tasks/claude-verify`（プロジェクト固有、非同期）: 実コマンド
#
# 委譲先タスク仕様:
#   mise run claude-verify
#   - 違反なし: exit 0、stdout 空
#   - 違反あり: exit 非ゼロ、stdout に全違反まとめ
#
# mise / task 不在ならサイレントに no-op。
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}"

command -v mise >/dev/null 2>&1 || exit 0
mise tasks ls --no-header 2>/dev/null | awk '{print $1}' | grep -qx 'claude-verify' || exit 0

if errors="$(mise run --quiet claude-verify 2>&1)"; then
  exit 0
fi

# mise が失敗時に "[task-name] ERROR task failed" を末尾に追記するので除去
errors="$(echo "$errors" | grep -vE '^\[claude-verify\] ERROR task failed$' || true)"
[[ -z "$errors" ]] && exit 0

# Stop hook では top-level の decision/reason を使う（hookSpecificOutput はスキーマ非対応）。
# decision: "block" で停止を阻止し、reason をシステムメッセージとしてエージェントに注入。
jq -Rn --arg msg "$errors" '{
  decision: "block",
  reason: ("🛑 Stop hook: 以下の問題が未解決です。修正してから完了してください:\n\n" + $msg)
}'
