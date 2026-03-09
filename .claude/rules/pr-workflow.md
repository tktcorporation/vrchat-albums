# PR ワークフロールール

## PR 作成後の CI ウォッチ

PR を作成した後は、必ず CI が完了するまでウォッチする。

```bash
gh pr checks <PR番号> --watch
```

- CI が全て pass したらユーザーに報告する
- fail したチェックがあれば、ログを確認して修正を試みる
  ```bash
  gh run view <run-id> --log-failed
  ```
- 修正後は再度 push して CI を再ウォッチする

## Changeset

機能追加・バグ修正の PR には必ず changeset ファイルを含める。
コミット・プッシュ前に changeset ファイルが存在するか確認し、なければ作成すること。

```bash
# .changeset/<変更を端的に表す名前>.md を作成
# minor: 機能追加、patch: バグ修正
```

形式:
```markdown
---
"cross-recorder": minor
---

変更の説明
```

- CI に `Changeset Check` ジョブがあり、changeset がないと fail する
- 1 PR に 1 changeset ファイルで十分（複数変更がある場合はまとめてよい）
- ドキュメントのみの変更やリファクタなど、バージョンに影響しない変更は不要
