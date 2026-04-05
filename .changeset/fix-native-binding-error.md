---
'vrchat-albums': patch
---

fix: ネイティブバインディングが見つからないエラーを修正

pnpm の isolated node_modules 構造で、@napi-rs/image 等のプラットフォーム固有の
オプショナル依存パッケージが electron-builder のパッケージングに含まれない問題を修正。
.npmrc に public-hoist-pattern を追加し、ネイティブモジュールをホイストするようにした。
