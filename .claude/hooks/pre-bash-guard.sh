#!/usr/bin/env bash
# PreToolUse フック: 危険な Bash コマンドをブロックする統合ガード。
#
# 全ブロックは hookSpecificOutput JSON 形式で出力し、
# エージェントが即座に代替手段を認識して修正できるようにする。
#
# ブロック対象:
#   1. lsof+kill / fuser+kill — devcontainer 巻き込み防止
#   2. 全ファイル revert/reset — 他プロセスの変更保護
#   3. worktree パス制約 — .claude/worktrees/ 配下のみ
#
# cf. .claude/rules/parallel-work.md

set -euo pipefail

INPUT="${CLAUDE_TOOL_INPUT:-}"

deny_with_json() {
  local reason="$1"
  # jq があれば安全にエスケープ、なければ printf フォールバック
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg reason "$reason" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
  else
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
  fi
  exit 0
}

# 1. 無差別プロセス kill ブロック (hookify.block-blind-kill.local.md と同等)
if echo "$INPUT" | grep -qE 'lsof.*-ti.*\|.*xargs.*kill|lsof.*-ti.*\|.*kill|kill.*\$\(lsof|kill.*lsof|fuser.*-k|kill\s+%[0-9]|kill\s+-9?\s*\$\(|pkill\s+-f'; then
  deny_with_json "無差別 kill はポートフォワーディングプロセスを巻き込んで devcontainer を殺す危険がある。代わりに: 1) lsof -i :PORT でプロセスを確認 2) 対象PIDを特定 3) kill <PID> で個別に停止すること。"
fi

# 2. 全ファイル revert/reset ブロック
if echo "$INPUT" | grep -qE 'git\s+checkout\s+--\s+\.|git\s+restore\s+\.|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|jj\s+restore\s+--(from|to|changes-in)'; then
  deny_with_json "全ファイル対象の revert/reset は他プロセスの変更を巻き込む。代わりに: 1) git checkout -- <特定ファイル> で個別に戻す 2) git stash push <ファイル> で退避 3) git worktree add .claude/worktrees/<名前> でワークスペースを分離すること。"
fi

# 3. worktree パス制約
# git worktree add [-b <branch>] [--detach] <path> のようにオプションがパスの前に来る
if echo "$INPUT" | grep -qE 'git\s+worktree\s+add'; then
  if ! echo "$INPUT" | grep -qE '\.claude/worktrees/'; then
    deny_with_json "worktree は .claude/worktrees/ 配下に作成すること。例: git worktree add .claude/worktrees/<タスク名> -b <ブランチ名> origin/main"
  fi
fi

# 通過
exit 0
