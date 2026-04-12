# エラーハンドリングルール

## 基本: try-catch を避け、Effect TS を使用

| 状況          | パターン                                                            |
| ------------- | ------------------------------------------------------------------- |
| 同期処理      | `Effect.try({ try: () => ..., catch: (e): MyError => ... })`        |
| 非同期処理    | `Effect.tryPromise({ try: () => ..., catch: (e): MyError => ... })` |
| Effect の連結 | `.pipe(Effect.flatMap())`, `.pipe(Effect.map())`                    |
| エラー分岐    | `Effect.match` または ts-pattern                                    |

### try-catch が許容されるケース

1. `finally` でリソースクリーンアップが必要（`Effect.acquireRelease` を優先検討）
2. Electron環境検出パターン（`require('electron')` の try-catch）
3. ts-pattern でエラー分類し、予期しないエラーを再スローする場合

---

## エラーの分類

| 種別             | 処理                             | 例                                           |
| ---------------- | -------------------------------- | -------------------------------------------- |
| 予期されたエラー | `Effect.Effect<T, E>` で返す     | ファイル未検出、バリデーション、タイムアウト |
| 予期しないエラー | `throw` で再スロー（Sentry送信） | DB接続エラー、メモリ不足、プログラミングミス |

---

## エラー型は具体的に定義

```typescript
// ❌ Effect.Effect<Data, Error> — パターンマッチ不可
// ✅ 呼び出し側で exhaustive にハンドリング可能
type GetDataError =
  | { type: 'NOT_FOUND'; id: string }
  | { type: 'VALIDATION_ERROR'; message: string };
function getData(): Effect.Effect<Data, GetDataError> { ... }
```

---

## エラー分類には ts-pattern を使用

```typescript
catch (error) {
  return match(error)
    .with({ code: 'ENOENT' }, (e) => Effect.fail({ type: 'FILE_NOT_FOUND', path: e.path }))
    .with({ code: 'EACCES' }, (e) => Effect.fail({ type: 'PERMISSION_DENIED', path: e.path }))
    .otherwise((e) => { throw e; }); // 予期しないエラーは再スロー
}
```

---

## 禁止パターン

| パターン                                        | 問題                                              |
| ----------------------------------------------- | ------------------------------------------------- |
| `throw new Error(\`Failed: ${error.message}\`)` | スタックトレース消失。`{ cause: error }` を使用   |
| `catch (e) { console.log(...) }`                | エラー握りつぶし。Sentry に送信されない           |
| `Effect.Effect<T, Error \| any \| unknown>`     | パターンマッチ不可。具体型を定義                  |
| catch 内で `Effect.fail(error)` のみ            | 予期しないエラーもラップされる。ts-pattern で分類 |

---

## レイヤー別の責務

| レイヤー | 責務                               | パターン                       |
| -------- | ---------------------------------- | ------------------------------ |
| Service  | エラー分類、予期されたエラーの返却 | `Effect.Effect<T, E>`          |
| tRPC     | Effect→UserFacingError変換         | `runEffect()`                  |
| Frontend | ユーザー向けメッセージ表示         | Toast + `parseErrorFromTRPC()` |

## 関連リンター

`pnpm lint:effect` / `pnpm lint:ts-pattern`
