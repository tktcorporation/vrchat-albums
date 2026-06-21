#!/usr/bin/env bash
# PostToolUse framework hook: Edit/Write 後に project の mise task に委譲して
# format + lint を実行し、違反は additionalContext として Claude に注入する。
#
# 責務分離:
#   - このスクリプト（汎用、ziku 同期対象）: ファイルパス抽出 → mise 委譲 → JSON 整形
#   - project の `.mise/tasks/claude-postedit`（プロジェクト固有、非同期）: 実コマンド
#
# 委譲先タスク仕様:
#   mise run claude-postedit -- <file>
#   - 違反なし: exit 0、stdout 空
#   - 違反あり: exit 非ゼロ、stdout に診断メッセージ
#   - 対象外ファイル: exit 0
#
# mise / task 不在ならサイレントに no-op。
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}"

command -v mise >/dev/null 2>&1 || exit 0
# --local: グローバルタスク (~/.config/mise/tasks) を除外し、リポジトリが
# claude-postedit を定義していないときの no-op を保つ（同名のユーザー設定タスクで
# 意図せず lint が走るのを防ぐ）。
mise tasks ls --local --no-header 2>/dev/null | awk '{print $1}' | grep -qx 'claude-postedit' || exit 0

# ツール入力 JSON: CLAUDE_TOOL_INPUT (一部 harness が設定) を優先し、
# 無ければ stdin から読む (公式 Claude Code はフックへ stdin で JSON を渡す)。
input="${CLAUDE_TOOL_INPUT:-}"
[[ -z "$input" ]] && input="$(cat)"
[[ -z "$input" ]] && exit 0

# フック完全ペイロードでは file_path が tool_input.file_path にネストされる。top-level も後方互換で許容。
file="$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // .file_path // .path // empty' 2>/dev/null || true)"
[[ -z "$file" || ! -f "$file" ]] && exit 0

if diag="$(mise run --quiet claude-postedit -- "$file" 2>&1)"; then
  exit 0
fi

# mise が失敗時に "[task-name] ERROR task failed" を末尾に追記するので除去
diag="$(echo "$diag" | grep -vE '^\[claude-postedit\] ERROR task failed$' || true)"
[[ -z "$diag" ]] && exit 0

jq -Rn --arg msg "$diag" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: ("⚠ post-edit check failed:\n" + $msg + "\nFix these issues before proceeding.")
  }
}'
