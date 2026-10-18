# Agent instructions

`CLAUDE.md` is the shared source of truth for project guidance. Read and follow it.
This entry point is for Cursor, Codex, Claude Code, and other AGENTS.md-aware tools.

## Layout

| Path                   | Role                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| `CLAUDE.md`            | Project overview, commands, architecture                         |
| `.claude/skills/`      | Task skills (Claude Code and Cursor both load these)             |
| `.claude/rules/`       | Behavioral rules (SSOT)                                          |
| `.claude/hooks/`       | Shared hook scripts + `manifest.json` (SSOT for wiring)          |
| `.cursor/` / `.codex/` | Generated / thin adapters — see `.claude/guides/tools/cursor.md` |

When a task matches a skill description, read that skill under `.claude/skills/` and follow it.
When changing code, also apply the relevant files under `.claude/rules/`.
To change hook wiring or Cursor rule wrappers, edit the SSOT and run `pnpm agent-adapters:generate`.

For cloud sessions using `functions.exec`, read `.claude/guides/tools/cloud-review.md`
before creating a PR. Use its guarded creation wrapper; repository hook files alone
do not establish that the host intercepts nested tool calls.
