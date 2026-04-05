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

`packages/ziku-cli/` を変更する PR には changeset ファイルを含める。
コミット・プッシュ前に changeset ファイルが存在するか確認し、なければ作成すること。

```bash
# .changeset/<変更を端的に表す名前>.md を作成
# minor: 機能追加、patch: バグ修正
```

形式:

```markdown
---
"@tktco/ziku": patch
---

変更の説明
```

- CI に `Changeset Check` ジョブがあり、changeset がないと fail する
- ドキュメントのみの変更やリファクタなど、バージョンに影響しない変更は不要
