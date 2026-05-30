---
'vrchat-albums': patch
---

依存パッケージのアップグレード（ランタイム検証可能な範囲）

- React 19.2.6 / `@trpc/*` 11.17 / `@tanstack/react-query` 5.100 / effect 3.21.2 /
  vite 8.0.14 / vitest 4.1.7 など、レンジ内の更新
- TypeScript 6.0、lucide-react 1.16、`@sequelize` alpha.48、
  knip 6、npm-run-all2 9、`@sentry/vite-plugin` 5、oxfmt 0.52、oxlint 1.67 など
- tRPC 11.17 で必須化された `ProcedureCallOptions.batchIndex` をテストに追加
- oxlint 1.67 / tsgo で必要となった `electron/tsconfig.json` の `rootDir` 明示
- oxlint 1.67 の新ルール対応（存在しなくなったルール削除・新規 correctness ルールの warn 化）
- 冗長になった `undici` の pnpm.overrides を削除（@sentry/cli の宣言どおり undici 6.26.0
  に自然解決され、セキュリティ下限 6.24.0 を満たす）

electron 本体 / electron-store / electron-unhandled / jsdom / `@types/node` は
ランタイム・ABI・ESM・engines 制約の検証が必要なため別 PR に分離。
