# neverthrow エラーハンドリングリンター

## 概要

このプロジェクトでは、型安全なエラーハンドリングを実現するために `neverthrow` ライブラリの `Result<T, E>` 型を使用しています。特定のレイヤー（サービス層など）では、すべての非同期関数が `Result` 型を返すべきです。

`lint:neverthrow` カスタムリンターは、このルールを自動的にチェックします。

## 使い方

### リンターの実行

```bash
# neverthrowリンターのみを実行
yarn lint:neverthrow

# すべてのリンターを実行（neverthrowリンターも含む）
yarn lint
```

### 設定ファイル

リンターの動作は `.neverthrowlintrc.json` で設定できます：

```json
{
  "rules": [
    {
      "name": "Service layer must use neverthrow Result type",
      "path": "electron/module/**/service.ts",
      "enforceResult": true,
      "apply": "async-functions",
      "exceptions": [
        "getAppVersion",
        "clearMigrationCache"
      ]
    }
  ]
}
```

### 設定オプション

#### `path`
リンターが検査する対象ファイルのglobパターン。

例：
- `electron/module/**/service.ts` - すべてのサービスファイル
- `electron/module/logInfo/*.ts` - logInfoモジュール内のすべてのTSファイル

#### `apply`
どの関数を検査対象にするかを指定：

- `"async-functions"` - 非同期関数（`async`キーワードまたは`Promise`を返す関数）のみ
- `"exported-functions"` - エクスポートされた関数のみ
- `"all-functions"` - すべての関数

推奨：`"async-functions"`（エラーハンドリングが必要なのは主に非同期処理のため）

#### `exceptions`
検査から除外する関数名のリスト。

例外を追加すべきケース：
- 戻り値が単純な値で、エラーが発生しない関数（例：`getAppVersion`）
- void を返す副作用のみの関数（例：`clearMigrationCache`）
- サードパーティAPIの型に合わせる必要がある関数

## ⚠️ 重要：予期されたエラー vs 予期しないエラー

### 基本原則

**neverthrowを使うべきなのは「ハンドリング可能な予期されたエラー」のみです。**

- ✅ **予期されたエラー** → `Result<T, E>` でラップして返す
- ❌ **予期しないエラー** → `throw` して、Sentryに送信させる

### なぜこれが重要なのか？

全てのエラーをneverthrowでラップすると：
- 予期しないエラーがユーザーに静かに返される
- Sentryに送信されず、バグの検知が遅れる
- デバッグが困難になる

### エラーの分類

#### 予期されたエラー（Result型で返すべき）

- ファイルが見つからない（`ENOENT`）
- バリデーションエラー
- 権限エラー（ユーザー操作で解決可能）
- ネットワークタイムアウト（リトライ可能）
- ビジネスロジック上の制約違反

#### 予期しないエラー（throwすべき）

- データベース接続エラー
- メモリ不足
- 型が想定外（プログラミングエラー）
- 外部ライブラリの内部エラー
- **原因不明のエラー全般**

### 正しい実装パターン

#### ❌ Bad：全てのエラーをラップ（Sentryに送信されない）

```typescript
export async function getWorldNameSuggestions(
  query: string
): Promise<Result<string[], Error>> {
  try {
    const results = await db.query(...);
    return ok(results.map(r => r.name));
  } catch (error) {
    // ❌ 予期しないエラーもラップしてしまう
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
```

#### ✅ Good：予期されたエラーのみラップ

```typescript
import { Result, ok, err } from 'neverthrow';
import { match } from 'ts-pattern';

// 予期されたエラー型を定義
type WorldNameSuggestionsError =
  | { type: 'VALIDATION_ERROR'; message: string }
  | { type: 'DATABASE_TIMEOUT'; message: string };

export async function getWorldNameSuggestions(
  query: string
): Promise<Result<string[], WorldNameSuggestionsError>> {
  try {
    // バリデーション（予期されたエラー）
    if (query.length < 2) {
      return err({
        type: 'VALIDATION_ERROR',
        message: 'Query must be at least 2 characters'
      });
    }

    const results = await db.query(...);
    return ok(results.map(r => r.name));
  } catch (error) {
    // エラーを分類
    return match(error)
      .with({ code: 'ETIMEDOUT' }, (e) =>
        // ✅ 予期されたエラー → Resultで返す
        err({ type: 'DATABASE_TIMEOUT', message: e.message })
      )
      .otherwise((e) => {
        // ✅ 予期しないエラー → re-throw（Sentryに送信される）
        throw e;
      });
  }
}
```

#### ✅ Good（簡略版）：データベースエラーは基本的にthrow

```typescript
export async function getWorldNameSuggestions(
  query: string
): Promise<Result<string[], ValidationError>> {
  // バリデーションエラーのみResult型で返す
  if (query.length < 2) {
    return err(new ValidationError('Query too short'));
  }

  // データベースエラーは予期しないエラーとしてthrow
  // （Sentryに送信される）
  const results = await db.query(...);
  return ok(results.map(r => r.name));
}
```

## エラーの修正方法

### エラー例

```
📄 electron/module/logInfo/service.ts
  ❌ 458:40 - Function 'getWorldNameSuggestions' should return Result<T, E> type from neverthrow (Rule: Service layer must use neverthrow Result type)
```

### 修正手順

1. **エラーを分類する**：この関数で発生しうる予期されたエラーは何か？
2. **予期されたエラー型を定義する**（または既存の型を使う）
3. **予期されたエラーのみResult型でラップする**
4. **予期しないエラーはre-throwする**

## リンターの仕組み

このリンターは2種類のチェックを実行します:

### 1. Result型の強制チェック

1. TypeScript Compiler APIを使用してソースコードを解析
2. 設定ファイルのルールに一致するファイルを検査
3. 各関数の戻り値の型を確認
4. `Result<T, E>` または `Promise<Result<T, E>>` を返しているかチェック
5. 違反を検出したらエラーを報告

### 2. catch-errアンチパターンの検出

Result型を返す関数に対して、以下のアンチパターンを検出します:

- `catch` ブロック内でエラーを `err()` でラップしているが、エラーの分類を行っていない
- エラーの分類とは:
  - `match()` や `if` 文でエラーの種類（エラーコード、型など）を判定すること
  - **注意**: `instanceof Error` だけのチェックは分類とみなされません
  - または予期しないエラーを `throw` で再スローすること

#### アンチパターンの例

```typescript
// ❌ Bad: エラーの分類なしでそのままラップ
try {
  const result = await someOperation();
  return ok(result);
} catch (error) {
  // instanceof Error だけのチェックは分類ではない
  return err(
    match(error)
      .with(P.instanceOf(Error), (err) => err)
      .otherwise(() => new Error('Unknown error'))
  );
}
```

#### 正しい実装

```typescript
// ✅ Good: エラーコード/タイプで分類
try {
  const result = await someOperation();
  return ok(result);
} catch (error) {
  return match(error)
    .with({ code: 'ENOENT' }, (e) =>
      err({ type: 'FILE_NOT_FOUND', message: e.message })
    )
    .with({ code: 'EACCES' }, (e) =>
      err({ type: 'PERMISSION_DENIED', message: e.message })
    )
    .otherwise((e) => {
      // 予期しないエラーはre-throw
      throw e;
    });
}
```

### ⚠️ 要注意: 汎用的なエラー型

`Result<T, Error>`、`Result<T, any>`、`Result<T, unknown>` のように、エラー型が汎用的な場合は特に注意が必要です。これらは適切なエラー分類が行われていない兆候である可能性があります。

理想的には、エラー型は具体的な型（ユニオン型など）であるべきです:

```typescript
// ✅ Good: 具体的なエラー型
type MyFunctionError =
  | { type: 'FILE_NOT_FOUND'; path: string }
  | { type: 'VALIDATION_ERROR'; message: string }
  | { type: 'PERMISSION_DENIED'; resource: string };

export function myFunction(): Result<Data, MyFunctionError> {
  // ...
}

// ⚠️ 可能な限り避ける: 汎用的なエラー型
export function myFunction(): Result<Data, Error> {
  // ...
}
```

#### 例外: Sentry通知済みエラー

ただし、以下のケースでは `Error` 型の使用が許容されます：

```typescript
// ✅ 許容: logger.error()でSentryに通知済みのエラー
export async function processData(): Promise<Result<Data, Error>> {
  try {
    const result = await complexOperation();
    return ok(result);
  } catch (error) {
    // Sentryに通知してからErrorとして返す
    logger.error('Unexpected error in processData', error);
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
```

**重要**: このパターンを使う場合でも、可能であれば予期されたエラーは具体的な型で分類し、予期しないエラーのみをSentry通知してから返すようにしてください。

## テスト

リンターのテストは `scripts/lint-neverthrow.test.ts` にあります：

```bash
yarn test scripts/lint-neverthrow.test.ts
```

## 既存コードの対応

リンターを導入した時点で、既存のコードには多くのエラーが検出される可能性があります。段階的に対応する場合：

1. 新しいコードから `Result` 型を使用開始
2. 既存の関数を `.neverthrowlintrc.json` の `exceptions` に追加
3. 徐々に既存関数を `Result` 型に移行し、`exceptions` から削除

## 関連ドキュメント

- [CLAUDE.md - Error Handling パターン](../CLAUDE.md#error-handling)
- [neverthrow 公式ドキュメント](https://github.com/supermacro/neverthrow)
