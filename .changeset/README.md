# Changesets

このフォルダは [Changesets](https://github.com/changesets/changesets) によって管理されています。

## 使い方

機能追加・バグ修正の PR には changeset ファイルを含めてください:

```bash
pnpm changeset
```

対話的にバージョンの種類（patch/minor）と変更内容を入力すると、`.changeset/` に markdown ファイルが作成されます。

バージョンに影響しない変更（ドキュメント、リファクタなど）の場合:

```bash
pnpm changeset --empty
```

## リリースフロー

1. feature PR に changeset ファイルを含めてマージ
2. `changesets/action` が自動で "chore: release" PR を作成・更新
3. その PR をマージすると、バージョンが bump されリリースが走る
