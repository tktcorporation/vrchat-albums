#!/bin/bash
# Hook: git commit/add を検出して jj の使用を促す
# PreToolUse hook for Bash tool

set -euo pipefail

# stdin から JSON を読み取る
input=$(cat)

# tool_input.command を抽出
command=$(echo "$input" | jq -r '.tool_input.command // empty')

if [ -z "$command" ]; then
  exit 0
fi

# git commit を検出
if echo "$command" | grep -qE '^\s*git\s+commit'; then
  cat <<'EOF'
╭──────────────────────────────────────────────╮
│  git commit の代わりに jj を使ってください    │
│                                              │
│  jj commit -m "message"                      │
│  jj describe -m "message"                    │
│                                              │
│  参考: CLAUDE.md, .claude/rules/jujutsu.md   │
╰──────────────────────────────────────────────╯
EOF
  exit 2
fi

# git add を検出
if echo "$command" | grep -qE '^\s*git\s+add'; then
  cat <<'EOF'
╭──────────────────────────────────────────────╮
│  git add は不要です                           │
│                                              │
│  jj は変更を自動的に追跡します               │
│  直接 jj commit -m "message" を使ってください │
│                                              │
│  参考: CLAUDE.md, .claude/rules/jujutsu.md   │
╰──────────────────────────────────────────────╯
EOF
  exit 2
fi

exit 0
