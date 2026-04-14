#!/usr/bin/env bash
# PostToolUse フック: Write/Edit/MultiEdit 後に自動 lint を実行する。
#
# 目的:
#   フィードバック速度の最速化 (PostToolUse = ミリ秒レベル)
#   エージェントが lint 違反を即座に認識し、自動修正サイクルを回す。
#
# 出力形式:
#   hookSpecificOutput.additionalContext (JSON) でエージェントにフィードバック。
#   参照: Harness Engineering Best Practices (2026)
#
# ADR: ADR-003 (PostToolUse auto-lint)

set -euo pipefail

# CLAUDE_FILE_PATHS: 変更されたファイルパスのリスト (改行区切り)
if [[ -z "${CLAUDE_FILE_PATHS:-}" ]]; then
  exit 0
fi

# TypeScript/TSX ファイルのみ対象
ts_files=()
while IFS= read -r file; do
  case "$file" in
    *.ts|*.tsx)
      if [[ -f "$file" ]]; then
        ts_files+=("$file")
      fi
      ;;
  esac
done <<< "$CLAUDE_FILE_PATHS"

if [[ ${#ts_files[@]} -eq 0 ]]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

violations=""

# 1. oxfmt で自動フォーマット (修正は適用、差分をレポート)
fmt_output=""
for f in "${ts_files[@]}"; do
  # --check で差分検出、あれば --write で自動修正
  if ! npx oxfmt --check "$f" >/dev/null 2>&1; then
    npx oxfmt --write "$f" 2>/dev/null || true
    fmt_output="${fmt_output}formatted: ${f}\n"
  fi
done

# 2. oxlint で静的解析 (修正可能なものは自動修正)
lint_output=""
for f in "${ts_files[@]}"; do
  result=$(npx oxlint "$f" 2>&1) || true
  if echo "$result" | grep -qE '^\s*(error|warning)\['; then
    lint_output="${lint_output}${result}\n"
  fi
done

# フィードバック生成
if [[ -n "$fmt_output" || -n "$lint_output" ]]; then
  context=""
  if [[ -n "$fmt_output" ]]; then
    context="[auto-fixed] oxfmt がフォーマットを修正しました: $(echo -e "$fmt_output" | tr '\n' ' ')"
  fi
  if [[ -n "$lint_output" ]]; then
    # lint 出力を1行に圧縮 (JSON安全)
    lint_summary=$(echo -e "$lint_output" | grep -E '^\s*(error|warning)\[' | head -10 | tr '\n' '; ' | sed 's/"/\\"/g')
    context="${context}[要修正] oxlint 違反: ${lint_summary}"
  fi

  cat <<HOOK_JSON
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "${context}"
  }
}
HOOK_JSON
fi

exit 0
