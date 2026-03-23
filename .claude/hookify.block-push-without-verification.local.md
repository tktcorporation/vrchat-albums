---
name: block-push-without-verification
enabled: true
event: bash
pattern: (jj\s+git\s+push|git\s+push)
action: warn
---

**プッシュをブロックしました。**

`.claude/rules/pre-push-verification.md` を読み、記載された手順を **すべて** 完了してからプッシュしてください。
