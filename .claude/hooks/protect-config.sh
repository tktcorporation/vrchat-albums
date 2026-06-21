#!/usr/bin/env bash
# PreToolUse フック: リンター設定ファイルの編集をブロック。
#
# 背景: エージェントは lint 違反に遭遇すると、コードを修正する代わりに
# リンター設定を緩める方向に逃げることがある。この問題を構造的に防ぐ。
#
# 記事の原則: 「LLM でできることをリンターに任せるな」の裏返しで、
# 「リンターの設定をLLMに触らせるな」。設定ファイルは不変（immutable）とする。
set -euo pipefail

input="${CLAUDE_TOOL_INPUT:-}"
if [[ -z "$input" ]]; then
  exit 0
fi

# Write/Edit ツールの file_path を取得
file="$(echo "$input" | jq -r '.file_path // .path // empty' 2>/dev/null || true)"
if [[ -z "$file" ]]; then
  exit 0
fi

# ファイル名のみを抽出（パスを含まない比較）
basename="$(basename "$file")"

# 保護対象のファイルパターン
PROTECTED_FILES=(
  ".oxlintrc.json"
  "sgconfig.yml"
  ".eslintrc"
  ".eslintrc.json"
  ".eslintrc.js"
  "eslint.config.js"
  "eslint.config.ts"
  "eslint.config.mjs"
  "biome.json"
  "biome.jsonc"
  ".prettierrc"
  ".prettierrc.json"
  "knip.json"
  "knip.ts"
)

for protected in "${PROTECTED_FILES[@]}"; do
  if [[ "$basename" == "$protected" ]]; then
    cat <<DENY_JSON
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED: ${basename} はリンター設定ファイルです。設定を変更するのではなく、コードを修正してください。lint ルールの無効化が本当に必要な場合は、理由を説明してユーザーに確認を取ってください。"
  }
}
DENY_JSON
    exit 0
  fi
done

# ast-grep ルールファイルも保護（rules/*.yml）
case "$file" in
  */rules/*.yml|rules/*.yml)
    cat <<DENY_JSON
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED: ast-grep ルールファイル (${basename}) の編集は禁止されています。ルールに合致するようコードを修正してください。ルール自体の変更が必要な場合はユーザーに確認を取ってください。"
  }
}
DENY_JSON
    exit 0
    ;;
esac

exit 0
