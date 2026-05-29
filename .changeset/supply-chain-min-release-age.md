---
---

サプライチェーン攻撃（Shai-Hulud 等）対策の強化。アプリ本体の挙動には影響しない。

- 効いていなかった `.npmrc` の `min-released-date=3d`（pnpm に存在しない設定キー）を、pnpm が認識する `minimumReleaseAge: 4320`（3日 / 分単位）に修正し `pnpm-workspace.yaml` へ移設。
- pnpm を 11 系（`pnpm@11.4.0`）へ更新。`minimumReleaseAge` が有効化され、`package.json` の `pnpm` フィールド廃止に伴い `overrides` / `onlyBuiltDependencies`（→ `allowBuilds`）/ `resolutionMode` / `publicHoistPattern` を `pnpm-workspace.yaml` に集約。
- Aikido Safe Chain による依存インストールのマルウェアスキャンを CI（`supply-chain-scan.yml`）に追加。
- `lint:native-hoist` の hoist パターン参照元を `.npmrc` から `pnpm-workspace.yaml` に追従。
