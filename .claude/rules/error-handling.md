# エラーハンドリングルール

このドキュメントは、プロジェクト全体で統一されたエラーハンドリングのベストプラクティスを定義します。

---

## 基本原則

### try-catch を避け、Effect TS + ts-pattern を使用する

**このプロジェクトでは `try-catch` の使用を原則として避けます。**

代わりに、以下の組み合わせでエラーハンドリングを行います:

| 状況 | 使用するパターン |
|------|-----------------|
| 同期処理でエラーが発生しうる | `Effect.try()` |
| 非同期処理でエラーが発生しうる | `Effect.tryPromise()` |
| Effect のエラーを分岐処理 | `Effect.match` または ts-pattern |
| 複数の Effect を連結 | `.pipe(Effect.flatMap())`, `.pipe(Effect.map())` |

```typescript
// ✅ 推奨: Effect TS + ts-pattern
import { Effect } from 'effect';
import { match } from 'ts-pattern';

// 同期処理
const safeParse = (input: string) =>
  Effect.try({
    try: () => JSON.parse(input),
    catch: (e): ParseError => ({ type: 'PARSE_ERROR', message: String(e) }),
  });

// 非同期処理
const fetchData = (url: string) =>
  Effect.tryPromise({
    try: () => fetch(url).then(r => r.json()),
    catch: (e): FetchError => ({ type: 'FETCH_ERROR', message: String(e) }),
  });

// 結果のハンドリング
const program = fetchData('/api/data').pipe(
  Effect.match({
    onSuccess: (value) => handleSuccess(value),
    onFailure: (error) =>
      match(error)
        .with({ type: 'FETCH_ERROR' }, (e) => showRetryDialog(e))
        .exhaustive(),
  })
);
await Effect.runPromise(program);
```

#### try-catch が許容されるケース

以下の場合のみ `try-catch` の使用を許容します:

1. **`finally` でリソースクリーンアップが必要な場合**（ただし `Effect.acquireRelease` の使用を優先検討）
2. **Electron環境検出パターン** (`require('electron')` のtry-catch)
3. **ts-patternでエラーを分類し、予期しないエラーを再スローする場合**

```typescript
// 許容例: finally でクリーンアップ
try {
  resource = await acquireResource();
  return Effect.succeed(await processResource(resource));
} catch (error) {
  return match(error)
    .with({ code: 'ETIMEDOUT' }, () => Effect.fail({ type: 'TIMEOUT' }))
    .otherwise((e) => { throw e; }); // 予期しないエラーは再スロー
} finally {
  await resource?.release();
}
```

---

### Effect TS の使い分け

| エラー種別 | 処理方法 | 理由 |
|-----------|---------|------|
| 予期されたエラー | `Effect.Effect<T, E>` で返す | ユーザーが対処可能、呼び出し側でハンドリング |
| 予期しないエラー | `throw` で再スロー（または Effect の defect として扱う） | Sentryで検知してバグを追跡 |

### 予期されたエラーの例

- ファイル未検出 (`ENOENT`)
- バリデーションエラー
- ユーザーキャンセル
- タイムアウト（リトライ可能）
- ビジネスロジック上の制約違反

### 予期しないエラーの例

- データベース接続エラー
- メモリ不足
- 型エラー（プログラミングミス）
- 外部ライブラリの内部エラー
- **原因不明のエラー全般**

---

## アンチパターン（絶対禁止）

### 1. スタックトレース消失

`new Error()` でエラーを包み直すと、元のスタックトレースが失われ、デバッグが困難になります。

**❌ 禁止パターン:**

```typescript
catch (error) {
  // ❌ スタックトレースが消失する
  throw new Error(`Failed: ${error.message}`);
}
```

**✅ 正しいパターン:**

```typescript
catch (error) {
  // ✅ causeで元エラーを保持（ES2022+）
  throw new Error('Failed to process', { cause: error });

  // または元のエラーをそのまま再スロー
  throw error;
}
```

### 2. エラーの握りつぶし

エラーをキャッチして何もしないと、Sentryに送信されずバグが検知されません。

**❌ 禁止パターン:**

```typescript
try {
  await riskyOperation();
} catch (error) {
  // ❌ Sentryに送信されず、バグが検知されない
  console.log('Something went wrong');
}
```

**✅ 正しいパターン:**

```typescript
try {
  await riskyOperation();
} catch (error) {
  // ✅ Sentryに送信
  logger.error('Operation failed', error);

  // 予期されたエラーなら Effect.fail() で返す
  // 予期しないエラーなら再スロー
  throw error;
}
```

### 3. 汎用Error型の使用

`Effect.Effect<T, Error>`, `Effect.Effect<T, any>`, `Effect.Effect<T, unknown>` は、呼び出し側でパターンマッチできません。

**❌ 禁止パターン:**

```typescript
// ❌ 呼び出し側でパターンマッチできない
function getData(): Effect.Effect<Data, Error> {
  // ...
}
```

**✅ 正しいパターン:**

```typescript
type GetDataError =
  | { type: 'NOT_FOUND'; id: string }
  | { type: 'VALIDATION_ERROR'; message: string };

// ✅ 呼び出し側でexhaustiveにハンドリング可能
function getData(): Effect.Effect<Data, GetDataError> {
  // ...
}
```

**例外:** `logger.error()` でSentryに通知済みの場合は許容されます。

### 4. catch内でEffect.fail()のみを返す

catchブロックでエラーを分類せずにそのまま `Effect.fail()` で返すと、予期しないエラーもラップされてしまいます。

**❌ 禁止パターン:**

```typescript
try {
  const result = await operation();
  return Effect.succeed(result);
} catch (error) {
  // ❌ 全てのエラーをラップ（Sentryに送信されない）
  return Effect.fail(error instanceof Error ? error : new Error(String(error)));
}
```

**✅ 正しいパターン:**

```typescript
try {
  const result = await operation();
  return Effect.succeed(result);
} catch (error) {
  return match(error)
    .with({ code: 'ENOENT' }, (e) =>
      Effect.fail({ type: 'FILE_NOT_FOUND', path: e.path })
    )
    .with({ code: 'EACCES' }, (e) =>
      Effect.fail({ type: 'PERMISSION_DENIED', path: e.path })
    )
    .otherwise((e) => {
      // ✅ 予期しないエラーは再スロー（Sentryに送信される）
      throw e;
    });
}
```

---

## 正しいパターン

### エラー分類には ts-pattern を使用

```typescript
import { match } from 'ts-pattern';

try {
  const result = await operation();
  return Effect.succeed(result);
} catch (error) {
  return match(error)
    .with({ code: 'ENOENT' }, (e) =>
      Effect.fail({ type: 'FILE_NOT_FOUND', path: e.path })
    )
    .with({ code: 'EACCES' }, (e) =>
      Effect.fail({ type: 'PERMISSION_DENIED', path: e.path })
    )
    .otherwise((e) => {
      // 予期しないエラーは再スロー
      throw e;
    });
}
```

### Effect.try / Effect.tryPromise を優先

`try-catch` よりも Effect TS のユーティリティを使用することを推奨します。

```typescript
import { Effect } from 'effect';

// 同期関数の場合
const safeParse = (str: string) =>
  Effect.try({
    try: () => JSON.parse(str),
    catch: (error): ParseError => ({ type: 'PARSE_ERROR', message: String(error) }),
  });

// 非同期関数の場合
function fetchData(url: string): Effect.Effect<Data, FetchError> {
  return Effect.tryPromise({
    try: () => fetch(url).then(r => r.json()),
    catch: (error): FetchError => ({ type: 'FETCH_ERROR', message: String(error) }),
  });
}
```

### Effect の合成（pipe / flatMap / map）

```typescript
import { Effect, pipe } from 'effect';

// 複数の Effect を連結
const program = pipe(
  fetchData('/api/user'),
  Effect.flatMap((user) => fetchData(`/api/user/${user.id}/photos`)),
  Effect.map((photos) => photos.filter(p => p.isPublic)),
  Effect.mapError((error) => ({ ...error, context: 'photo-loading' })),
);
```

### tRPC層でのEffect→UserFacingError変換

```typescript
import { runEffectForTRPC } from '../lib/effectHelpers';

// tRPC procedure
openFile: procedure.input(z.string()).mutation(async (ctx) => {
  return await runEffectForTRPC(service.openFile(ctx.input));
}),
```

---

## レイヤー別の責務

| レイヤー | 責務 | 使用パターン |
|---------|------|-------------|
| Service | エラー分類、予期されたエラーの返却 | `Effect.Effect<T, E>` |
| tRPC | Effect→UserFacingError変換 | `runEffectForTRPC()` |
| Frontend | ユーザー向けメッセージ表示 | Toast + `parseErrorFromTRPC()` |

---

## 関連リンター

| コマンド | 説明 |
|---------|------|
| `pnpm lint:effect` | Effect型強制、エラーハンドリングパターン検出 |
| `pnpm lint:ts-pattern` | ts-patternの適切な使用をチェック |

### 設定ファイル

- `scripts/lint-effect.ts` - Effect リンタースクリプト
- `docs/lint-effect.md` - リンター詳細ドキュメント

---

## 参考リンク

- [Effect TS 公式](https://effect.website/)
- [ts-pattern公式](https://github.com/gvergnaud/ts-pattern)
- [docs/error-handling.md](../../docs/error-handling.md) - エラーハンドリング戦略の詳細
