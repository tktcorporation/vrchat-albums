# neverthrow エラーハンドリングリンター

## 概要

このプロジェクトでは、型安全なエラーハンドリングを実現するために `neverthrow` ライブラリの `Result<T, E>` 型を使用しています。特定のレイヤー（サービス層など）では、すべての非同期関数が `Result` 型を返すべきです。

`lint:neverthrow` カスタムリンターは、このルールを自動的にチェックします。

## 使い方

### リンターの実行

```bash
# neverthrowリンターのみを実行
pnpm lint:neverthrow

# すべてのリンターを実行（neverthrowリンターも含む）
pnpm lint
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
      "exceptions": ["getAppVersion", "clearMigrationCache"]
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
      .otherwise(() => new Error('Unknown error')),
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
      err({ type: 'FILE_NOT_FOUND', message: e.message }),
    )
    .with({ code: 'EACCES' }, (e) =>
      err({ type: 'PERMISSION_DENIED', message: e.message }),
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

## fromThrowable vs try-catch {#fromthrowable-vs-try-catch}

### 推奨パターン

`try-catch` の代わりに、neverthrow の `fromThrowable()` や `ResultAsync.fromPromise()` を使うことを推奨します。

#### 同期関数の場合: `fromThrowable()`

```typescript
import { fromThrowable } from 'neverthrow';

// ❌ try-catch パターン
function parseJsonBad(str: string): Result<Data, ParseError> {
  try {
    return ok(JSON.parse(str));
  } catch (error) {
    return err({ type: 'PARSE_ERROR', message: String(error) });
  }
}

// ✅ fromThrowable パターン
const safeParse = fromThrowable(
  (str: string) => JSON.parse(str),
  (error): ParseError => ({ type: 'PARSE_ERROR', message: String(error) }),
);

function parseJsonGood(str: string): Result<Data, ParseError> {
  return safeParse(str);
}
```

#### 非同期関数の場合: `ResultAsync.fromPromise()`

```typescript
import { ResultAsync } from 'neverthrow';

// ❌ try-catch パターン
async function fetchDataBad(url: string): Promise<Result<Data, FetchError>> {
  try {
    const response = await fetch(url);
    return ok(await response.json());
  } catch (error) {
    return err({ type: 'FETCH_ERROR', message: String(error) });
  }
}

// ✅ ResultAsync.fromPromise パターン
function fetchDataGood(url: string): ResultAsync<Data, FetchError> {
  return ResultAsync.fromPromise(
    fetch(url).then((r) => r.json()),
    (error): FetchError => ({ type: 'FETCH_ERROR', message: String(error) }),
  );
}
```

### 例外: try-catch が適切なケース

以下のケースでは、`try-catch` の使用が適切です：

1. **`finally` でリソースクリーンアップを行う場合**

```typescript
async function processWithCleanup(): Promise<Result<Data, ProcessError>> {
  let resource: Resource | null = null;
  try {
    resource = await acquireResource();
    const result = await processResource(resource);
    return ok(result);
  } catch (error) {
    return err({ type: 'PROCESS_ERROR', message: String(error) });
  } finally {
    // クリーンアップは try-catch が必要
    if (resource) {
      await resource.release();
    }
  }
}
```

2. **ts-pattern でエラーを分類し、予期しないエラーを再スローする場合**

```typescript
import { match } from 'ts-pattern';

async function readFileWithClassification(
  path: string,
): Promise<Result<string, FileError>> {
  try {
    return ok(await fs.readFile(path, 'utf-8'));
  } catch (error) {
    return match(error)
      .with({ code: 'ENOENT' }, () => err({ type: 'FILE_NOT_FOUND', path }))
      .with({ code: 'EACCES' }, () => err({ type: 'PERMISSION_DENIED', path }))
      .otherwise((e) => {
        throw e; // 予期しないエラーは再スロー
      });
  }
}
```

3. **Electron 環境検出パターン**

```typescript
function getLogPath(): string {
  try {
    const { app } = require('electron');
    return app.getPath('logs');
  } catch {
    return '/tmp/logs'; // テスト環境用フォールバック
  }
}
```

### 設定

`.neverthrowlintrc.json` で try-catch 警告を設定できます：

```json
{
  "tryCatchWarning": {
    "enabled": true,
    "path": "electron/**/*.ts",
    "exceptions": {
      "allowWithFinally": true,
      "allowInsideFromPromise": true,
      "allowWithRethrow": true,
      "allowElectronEnvDetection": true
    }
  }
}
```

| オプション                  | デフォルト | 説明                                                   |
| --------------------------- | ---------- | ------------------------------------------------------ |
| `enabled`                   | `false`    | 警告を有効にするか                                     |
| `path`                      | -          | 対象ファイルのglobパターン                             |
| `allowWithFinally`          | `true`     | `finally` ブロックがある場合はスキップ                 |
| `allowInsideFromPromise`    | `true`     | `ResultAsync.fromPromise()` 内はスキップ               |
| `allowWithRethrow`          | `true`     | 適切な再スローがある場合はスキップ                     |
| `allowElectronEnvDetection` | `true`     | `require('electron')` を含む環境検出パターンはスキップ |

## 汎用Errorタイプ警告 {#generic-error-warning}

`err(new Error(...))` パターンは、呼び出し側でエラーをパターンマッチできないため避けるべきです。

### 警告パターン

```typescript
// ❌ Bad: 汎用Error型
export function readFile(): Result<string, Error> {
  try {
    return ok(fs.readFileSync('file.txt', 'utf-8'));
  } catch (error) {
    return err(new Error('ファイルが読めませんでした'));
  }
}

// ❌ Bad: UNEXPECTEDタイプ
export function process(): Result<
  void,
  { type: 'UNEXPECTED'; message: string }
> {
  if (shouldFail) {
    return err({ type: 'UNEXPECTED', message: 'エラー' });
  }
  return ok(undefined);
}
```

### 推奨パターン

```typescript
// ✅ Good: 具体的なエラー型
type ReadFileError =
  | { type: 'FILE_NOT_FOUND'; path: string }
  | { type: 'PERMISSION_DENIED'; path: string };

export function readFile(path: string): Result<string, ReadFileError> {
  const accessResult = await accessAsync(path);
  if (accessResult.isErr()) {
    return err({ type: 'FILE_NOT_FOUND', path });
  }
  // ... 予期しないエラーはthrow
  return ok(content);
}

// ✅ Good: エラーメッセージヘルパー関数
export const getReadFileErrorMessage = (error: ReadFileError): string =>
  match(error)
    .with(
      { type: 'FILE_NOT_FOUND' },
      (e) => `ファイルが見つかりません: ${e.path}`,
    )
    .with(
      { type: 'PERMISSION_DENIED' },
      (e) => `アクセスが拒否されました: ${e.path}`,
    )
    .exhaustive();
```

### 設定

```json
{
  "genericErrorWarning": {
    "enabled": true,
    "path": "electron/**/*.ts"
  }
}
```

| オプション | デフォルト | 説明                       |
| ---------- | ---------- | -------------------------- |
| `enabled`  | `false`    | 警告を有効にするか         |
| `path`     | -          | 対象ファイルのglobパターン |

## テスト

リンターのテストは `scripts/lint-neverthrow.test.ts` にあります：

```bash
pnpm test scripts/lint-neverthrow.test.ts
```

## 既存コードの対応

リンターを導入した時点で、既存のコードには多くのエラーが検出される可能性があります。段階的に対応する場合：

1. 新しいコードから `Result` 型を使用開始
2. 既存の関数を `.neverthrowlintrc.json` の `exceptions` に追加
3. 徐々に既存関数を `Result` 型に移行し、`exceptions` から削除

## 関連ドキュメント

- [CLAUDE.md - Error Handling パターン](../CLAUDE.md#error-handling)
- [neverthrow 公式ドキュメント](https://github.com/supermacro/neverthrow)
