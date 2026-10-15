---
paths: ['**/*.ts', '**/*.tsx']
---

# エラーハンドリングの実現手段（このリポジトリ固有）

原則は `../error-handling.md` が SSOT。このファイルは、その原則をこのリポジトリのライブラリ構成（Effect TS・ts-pattern・tRPC）で実装するときの対応だけを書く。try-catch を禁止する判断の根拠は ADR-002（`docs/adr/002-effect-ts-error-handling.md`）。

## パターン

| 状況          | パターン                                                            |
| ------------- | ------------------------------------------------------------------- |
| 同期処理      | `Effect.try({ try: () => ..., catch: (e): MyError => ... })`        |
| 非同期処理    | `Effect.tryPromise({ try: () => ..., catch: (e): MyError => ... })` |
| Effect の連結 | `.pipe(Effect.flatMap())`, `.pipe(Effect.map())`                    |
| エラー分岐    | `Effect.match` または ts-pattern                                    |

予期しないエラーは `throw` で再スローし、Sentry に届ける。

捕捉した例外の分類には ts-pattern を使い、未知のケースは再スローする。

```typescript
return match(error)
  .with({ code: 'ENOENT' }, (e) =>
    Effect.fail({ type: 'FILE_NOT_FOUND', path: e.path }),
  )
  .with({ code: 'EACCES' }, (e) =>
    Effect.fail({ type: 'PERMISSION_DENIED', path: e.path }),
  )
  .otherwise((e) => {
    throw e;
  });
```

## 生の try-catch を書いてよいケース

`../error-handling.md` の 2 ケースに加え、Electron 環境の検出（`require('electron')` を try-catch で包む）を許容する。`finally` でのリソース解放は、先に `Effect.acquireRelease` を検討する。

## レイヤー別の責務

| レイヤー | 責務                               | パターン                       |
| -------- | ---------------------------------- | ------------------------------ |
| Service  | エラー分類、予期されたエラーの返却 | `Effect.Effect<T, E>`          |
| tRPC     | Effect→UserFacingError変換         | `runEffect()`                  |
| Frontend | ユーザー向けメッセージ表示         | Toast + `parseErrorFromTRPC()` |

## 関連リンター

`pnpm lint:effect` / `pnpm lint:ts-pattern`
