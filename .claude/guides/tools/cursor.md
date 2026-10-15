# Cursor 向けエージェント設定

エージェント設定の正本は `.claude/`（skills / rules / hooks / `CLAUDE.md`）。
Cursor（IDE と Cloud Agent）と Codex は、生成された薄いアダプタだけを持つ。

## SSOT と生成物

| 正本                          | 生成物（手編集しない）                                                        |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `.claude/hooks/manifest.json` | `.claude/settings.json` の `hooks`、`.cursor/hooks.json`、`.codex/hooks.json` |
| `.claude/rules/**/*.md`       | `.cursor/rules/**/*.mdc`（`@` で正本を参照）                                  |
| `.claude/skills/`             | （生成不要。Cursor が互換ロード）                                             |
| `CLAUDE.md`                   | （生成不要。`AGENTS.md` が入口）                                              |

```bash
pnpm agent-adapters:generate   # 生成
pnpm agent-adapters:check      # CI: 正本と生成物の乖離を落とす
```

hook を足す・matcher を変えるときは **manifest だけ** 編集して generate する。
rule を足すときは `.claude/rules/` に書いて generate する（`.mdc` は書かない）。

## ランタイム対応

| 役割         | Claude Code            | Codex                       | Cursor                        |
| ------------ | ---------------------- | --------------------------- | ----------------------------- |
| hook 配線    | settings.json（生成）  | `.codex/hooks.json`（生成） | `.cursor/hooks.json`（生成）  |
| 実行アダプタ | （直接 / skip ラッパ） | `.codex/run-shared-hook.ts` | `.cursor/run-shared-hook.ts`  |
| rules        | `.claude/rules/`       | AGENTS.md 経由              | `.cursor/rules/*.mdc`（生成） |

共有スクリプト本体はどれも `.claude/hooks/` だけを編集する。

## 二重実行の回避

Cursor IDE は third-party 設定を有効にすると `.claude/settings.json` の hooks も読む。
native の `.cursor/hooks.json` と二重になるのを避けるため、settings.json 側は
`.claude/hooks/run-or-skip-for-cursor.ts` 経由で起動する（manifest 生成がそう配線する）。

- 入力に `cursor_version` があり、かつ `.cursor/hooks.json` がある → 何もしない
- `.cursor/run-shared-hook.ts` 経由（`CURSOR_HOOK_VIA_ADAPTER=1`）→ 実行する
- Claude Code からの起動（`cursor_version` なし）→ 実行する
