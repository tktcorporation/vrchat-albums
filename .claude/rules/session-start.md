# セッション開始ルーチン

## 目的

セッション間の状態断絶を防ぎ、前セッションの成果物と現在の状態を正確に把握する。

## 開始時に実行する手順

### 1. 前セッションの状態把握

```bash
git log --oneline -10        # 直近のコミットで前セッションの作業を把握
git status                   # 未コミットの変更を確認
git stash list               # 退避された変更がないか確認
```

### 2. ブランチ状態の確認

```bash
git branch --show-current    # 現在のブランチ
git log --oneline main..HEAD # main からの差分コミット数
```

### 3. テスト・lint のヘルスチェック

```bash
pnpm test                    # テストが通る状態か確認
pnpm lint                    # lint が通る状態か確認
```

テストや lint が失敗している場合、**新しい作業を始める前に**修正する。

### 4. 未コミットの変更の判断

- 自分の変更 → コミットまたは stash して作業開始
- 他プロセスの変更 → `.claude/rules/parallel-work.md` に従い worktree を作成

## コミットメッセージの規約（セッション橋渡し）

セッション終了時のコミットメッセージに作業状態を含める:

```
feat: ○○を実装

[session-state] 次のセッションで △△ の実装が必要
```

## 進捗状態の保存形式

長期タスクの進捗は `.claude/plans/` に JSON 形式で保存する（Markdown より破損リスクが低い）。

```json
{
  "task": "タスク名",
  "status": "in_progress",
  "completed": ["ステップ1", "ステップ2"],
  "remaining": ["ステップ3"],
  "blockers": []
}
```
