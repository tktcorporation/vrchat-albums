# PR 作成前のセルフレビュー必須ルール

## 背景

Claude が作成した PR は、作成直後にセルフレビューを回すとほぼ確実に修正すべき問題が見つかる。2回レビューを回すと精度が大幅に上がる。

## 仕組み

`gh pr create` は PreToolUse フック（`.claude/hooks/require-pr-self-review.sh`）でブロックされる。セルフレビューを2回完了するまで PR は作成できない。

## 手順

PR を作成したいとき、以下を自動的に実行する:

### 1. セルフレビュー（1回目）

```bash
codex review --uncommitted
```

結果を確認し、指摘事項があれば修正する。

### 2. レビュー完了を記録

```bash
bash .claude/hooks/record-pr-review.sh
```

### 3. セルフレビュー（2回目）

1回目の修正を反映した状態で再度レビューする:

```bash
codex review --uncommitted
```

再び指摘事項があれば修正する。

### 4. レビュー完了を記録

```bash
bash .claude/hooks/record-pr-review.sh
```

### 5. PR 作成

2回のレビューが完了していれば `gh pr create` が通る。

## 注意

- レビュー回数のカウンターは `.claude/.pr-review-count` に記録される（gitignore 済み）
- PR 作成が許可された時点でカウンターは自動リセットされる
- `codex review` が使えない環境では、Agent ツールの code-reviewer サブエージェントを代替として使う
