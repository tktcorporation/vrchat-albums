#!/usr/bin/env bash
# PostToolUse フック: Write/Edit/MultiEdit 後に自動 lint を実行する。
#
# 目的:
#   フィードバック速度の最速化 (PostToolUse = ミリ秒レベル)
#   エージェントが lint 違反を即座に認識し、自動修正サイクルを回す。
#
# 出力形式:
#   hookSpecificOutput.additionalContext (JSON) でエージェントにフィードバック。
#   jq でエスケープし、不正な JSON 出力を防止する。
#
# ADR: ADR-003 (PostToolUse auto-lint)

# set -e は使わない。ツールの欠如やフォーマットエラーで
# フック全体が中断するのを防ぎ、可能な限りフィードバックを返す。
set -uo pipefail

# CLAUDE_FILE_PATHS: 変更されたファイルパスのリスト (改行区切り)
if [[ -z "${CLAUDE_FILE_PATHS:-}" ]]; then
  exit 0
fi

# 先に cd してからパス解決する（相対パスが正しく解決されるように）
cd "${CLAUDE_PROJECT_DIR:-.}"

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

# ツール存在チェック（なければ早期 exit、ミリ秒単位で完了）
OXFMT="./node_modules/.bin/oxfmt"
OXLINT="./node_modules/.bin/oxlint"
if [[ ! -x "$OXFMT" ]] || [[ ! -x "$OXLINT" ]]; then
  exit 0
fi

# 1. oxfmt で自動フォーマット (修正は適用、差分をレポート)
fmt_output=""
for f in "${ts_files[@]}"; do
  if ! "$OXFMT" --check "$f" >/dev/null 2>&1; then
    "$OXFMT" --write "$f" 2>/dev/null || true
    fmt_output="${fmt_output}formatted: ${f}; "
  fi
done

# 2. oxlint で静的解析
# 改行区切りで結果を蓄積（リテラル \n ではなく実際の改行を使用）
lint_output=""
for f in "${ts_files[@]}"; do
  result=$("$OXLINT" "$f" 2>&1) || true
  if printf '%s' "$result" | grep -qE '^\s*(error|warning)\['; then
    lint_output="${lint_output}${result}"$'\n'
  fi
done

# フィードバック生成（jq で安全に JSON エスケープ）
if [[ -n "$fmt_output" || -n "$lint_output" ]]; then
  context=""
  if [[ -n "$fmt_output" ]]; then
    context="[auto-fixed] oxfmt がフォーマットを修正しました: ${fmt_output}"
  fi
  if [[ -n "$lint_output" ]]; then
    lint_summary=$(printf '%s' "$lint_output" | grep -E '^\s*(error|warning)\[' | head -10 | tr '\n' '; ')
    context="${context}[要修正] oxlint 違反: ${lint_summary}"
  fi

  jq -n --arg ctx "$context" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $ctx
    }
  }'
fi

exit 0
