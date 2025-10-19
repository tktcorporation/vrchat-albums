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

1. TypeScript Compiler APIを使用してソースコードを解析
2. 設定ファイルのルールに一致するファイルを検査
3. 各関数の戻り値の型を確認
4. `Result<T, E>` または `Promise<Result<T, E>>` を返しているかチェック
5. 違反を検出したらエラーを報告

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
- [エラーハンドリング設計](./error-handling-design.md)（存在する場合）
