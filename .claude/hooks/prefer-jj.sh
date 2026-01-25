#!/bin/bash
# Claude Code hook: Prefer jj over git for commits
#
# This hook intercepts Bash commands and blocks git commit/add
# in favor of jj commands, per project workflow.

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // ""')

# Block git commit -> suggest jj commit
if [[ "$command" =~ ^git\ commit ]]; then
  cat <<'EOF' >&2

╭─────────────────────────────────────────────────╮
│  ⚠️  git commit is blocked - use jj instead     │
╰─────────────────────────────────────────────────╯

Instead of:  git commit -m "message"
Use:         jj commit -m "message"

See: CLAUDE.md, .claude/rules/jujutsu.md

EOF
  exit 2
fi

# Block git add -> suggest jj workflow (jj auto-stages)
if [[ "$command" =~ ^git\ add ]]; then
  cat <<'EOF' >&2

╭─────────────────────────────────────────────────╮
│  ⚠️  git add is not needed with jj             │
╰─────────────────────────────────────────────────╯

jj automatically tracks all changes.
Just use: jj commit -m "message"

See: .claude/rules/jujutsu.md

EOF
  exit 2
fi

# Allow all other commands
exit 0
