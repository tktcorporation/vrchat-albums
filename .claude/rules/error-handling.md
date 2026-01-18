# エラーハンドリングルール

このドキュメントは、プロジェクト全体で統一されたエラーハンドリングのベストプラクティスを定義します。

---

## 基本原則

### neverthrow の使い分け

| エラー種別 | 処理方法 | 理由 |
|-----------|---------|------|
| 予期されたエラー | `Result<T, E>` で返す | ユーザーが対処可能、呼び出し側でハンドリング |
| 予期しないエラー | `throw` で再スロー | Sentryで検知してバグを追跡 |

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

  // 予期されたエラーなら Result で返す
  // 予期しないエラーなら再スロー
  throw error;
}
```

### 3. 汎用Error型の使用

`Result<T, Error>`, `Result<T, any>`, `Result<T, unknown>` は、呼び出し側でパターンマッチできません。

**❌ 禁止パターン:**

```typescript
// ❌ 呼び出し側でパターンマッチできない
function getData(): Result<Data, Error> {
  // ...
}
```

**✅ 正しいパターン:**

```typescript
type GetDataError =
  | { type: 'NOT_FOUND'; id: string }
  | { type: 'VALIDATION_ERROR'; message: string };

// ✅ 呼び出し側でexhaustiveにハンドリング可能
function getData(): Result<Data, GetDataError> {
  // ...
}
```

**例外:** `logger.error()` でSentryに通知済みの場合は許容されます。

### 4. catch内でerr()のみを返す

catchブロックでエラーを分類せずにそのまま `err()` で返すと、予期しないエラーもラップされてしまいます。

**❌ 禁止パターン:**

```typescript
try {
  const result = await operation();
  return ok(result);
} catch (error) {
  // ❌ 全てのエラーをラップ（Sentryに送信されない）
  return err(error instanceof Error ? error : new Error(String(error)));
}
```

**✅ 正しいパターン:**

```typescript
try {
  const result = await operation();
  return ok(result);
} catch (error) {
  return match(error)
    .with({ code: 'ENOENT' }, (e) =>
      err({ type: 'FILE_NOT_FOUND', path: e.path })
    )
    .with({ code: 'EACCES' }, (e) =>
      err({ type: 'PERMISSION_DENIED', path: e.path })
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
  return ok(result);
} catch (error) {
  return match(error)
    .with({ code: 'ENOENT' }, (e) =>
      err({ type: 'FILE_NOT_FOUND', path: e.path })
    )
    .with({ code: 'EACCES' }, (e) =>
      err({ type: 'PERMISSION_DENIED', path: e.path })
    )
    .otherwise((e) => {
      // 予期しないエラーは再スロー
      throw e;
    });
}
```

### fromThrowable / ResultAsync.fromPromise を優先

`try-catch` よりも neverthrow のユーティリティを使用することを推奨します。

```typescript
import { fromThrowable, ResultAsync } from 'neverthrow';

// 同期関数の場合
const safeParse = fromThrowable(
  (str: string) => JSON.parse(str),
  (error): ParseError => ({ type: 'PARSE_ERROR', message: String(error) })
);

// 非同期関数の場合
function fetchData(url: string): ResultAsync<Data, FetchError> {
  return ResultAsync.fromPromise(
    fetch(url).then(r => r.json()),
    (error): FetchError => ({ type: 'FETCH_ERROR', message: String(error) })
  );
}
```

### tRPC層でのResult→UserFacingError変換

```typescript
import { handleResultError, fileOperationErrorMappings } from '../lib/errorHelpers';

// tRPC procedure
openFile: procedure.input(z.string()).mutation(async (ctx) => {
  const result = await service.openFile(ctx.input);
  handleResultError(result, fileOperationErrorMappings);
  return true;
}),
```

---

## レイヤー別の責務

| レイヤー | 責務 | 使用パターン |
|---------|------|-------------|
| Service | エラー分類、予期されたエラーの返却 | `Result<T, E>` |
| tRPC | Result→UserFacingError変換 | `handleResultError()` |
| Frontend | ユーザー向けメッセージ表示 | Toast + `parseErrorFromTRPC()` |

---

## 関連リンター

| コマンド | 説明 |
|---------|------|
| `yarn lint:neverthrow` | Result型強制、catch-errパターン検出 |
| `yarn lint:ts-pattern` | ts-patternの適切な使用をチェック |

### 設定ファイル

- `.neverthrowlintrc.json` - neverthrowリンター設定
- `docs/lint-neverthrow.md` - リンター詳細ドキュメント

---

## 参考リンク

- [neverthrow公式](https://github.com/supermacro/neverthrow)
- [ts-pattern公式](https://github.com/gvergnaud/ts-pattern)
- [docs/error-handling.md](../../docs/error-handling.md) - エラーハンドリング戦略の詳細
