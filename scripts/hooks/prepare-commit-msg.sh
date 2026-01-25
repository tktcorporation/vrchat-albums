#!/bin/bash
# jj workflow reminder hook
# This hook runs when using `git commit` to remind developers to use jj instead.
# Note: `jj commit` does not trigger this hook, making it a natural nudge.

cat << 'EOF'

╭─────────────────────────────────────────────────────────╮
│  💡 Reminder: This project uses jj (Jujutsu) by default │
╰─────────────────────────────────────────────────────────╯

  Instead of:  git commit -m "message"
  Use:         jj commit -m "message"

  Benefits:
  • Undo-friendly workflow
  • Better conflict resolution
  • Seamless Git interop

  Docs: docs/jujutsu-workflow.md

EOF
