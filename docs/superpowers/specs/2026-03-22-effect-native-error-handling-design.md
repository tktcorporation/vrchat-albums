# Effect TS ネイティブ エラーハンドリング再設計

## 背景

neverthrow → Effect TS 移行（PR #734）で `throw UserFacingError` パターンを踏襲したが、
Effect の `FiberFailure` ラッパーにより tRPC の `findUserFacingError` が `UserFacingError` を
発見できない問題が繰り返し発生した。

根本原因: Effect の E チャネル（型付きエラー）と `throw`（非型付きエラー）の二重構造。
Effect TS の思想に乗るなら、E チャネルを最後まで維持し、tRPC 境界でのみ変換すべき。

## 設計方針

- **Effect の E チャネルでエラーを最後まで伝播**。`throw` は tRPC 境界の `TRPCError` のみ
- **`Data.TaggedError` で 1 エラー = 1 クラス**。`Effect.catchTag` による型レベル網羅性チェック
- **`UserFacingError` は維持**。サービスのドメインエラーからの変換先として機能
- **`runEffectForTRPC` / `errorMappings` 辞書を廃止**。`pipe` 内で宣言的に変換
- **`mapError` で `cause` を必ず保持**。Sentry が元エラーを追跡可能にする

## 1. エラー型: `Data.TaggedError` ベース

### `Data.TaggedError` の特性

`Data.TaggedError` は Effect v3 で `Error` を extends する。
そのため `message` プロパティを明示的にフィールドに含めると、
`Error.message` として自動的にアクセス可能になる。
また `_tag` プロパティが自動付与され、`Effect.catchTag` で型安全にマッチできる。

### 変換ルール

| 現在 | 新 | 対応する `_tag` |
|------|-----|----------------|
| `class LogInfoError { code: 'DATABASE_QUERY_FAILED' }` | `class DatabaseQueryFailed extends Data.TaggedError("DatabaseQueryFailed")<{ message: string }> {}` | `"DatabaseQueryFailed"` |
| `class LogInfoError { code: 'LOG_FILE_READ_FAILED' }` | `class LogFileReadFailed extends Data.TaggedError("LogFileReadFailed")<{ message: string }> {}` | `"LogFileReadFailed"` |
| `{ type: 'DB_ERROR', message: string }` | `class DbError extends Data.TaggedError("DbError")<{ message: string }> {}` | `"DbError"` |
| `{ type: 'NO_METADATA_FOUND' }` | `class NoMetadataFound extends Data.TaggedError("NoMetadataFound")<{ photoPath: string }> {}` | `"NoMetadataFound"` |
| `{ type: 'PARSE_ERROR', message: string }` | `class MetadataParseError extends Data.TaggedError("MetadataParseError")<{ photoPath: string; message: string }> {}` | `"MetadataParseError"` |
| 1 クラスに複数 `code` | **廃止**。1 エラー = 1 クラス | — |

### 例: vrchatPhotoMetadata

```typescript
// electron/module/vrchatPhotoMetadata/errors.ts
import { Data } from 'effect';

/** DB アクセス時の予期しないエラー */
export class MetadataDbError extends Data.TaggedError("MetadataDbError")<{
  message: string;
}> {}

/** 写真ファイルに XMP メタデータが存在しない（正常系） */
export class NoMetadataFound extends Data.TaggedError("NoMetadataFound")<{
  photoPath: string;
}> {}

/** XMP メタデータのパースに失敗した（正常系） */
export class MetadataParseError extends Data.TaggedError("MetadataParseError")<{
  photoPath: string;
  message: string;
}> {}
```

### なぜ 1 エラー = 1 クラスか

`Effect.catchTag("NoMetadataFound", ...)` を呼ぶと、型レベルで E から `NoMetadataFound` が
消える。1 クラスに複数の `code` を持たせると、`catchTag` で個別に処理できず、
`catchAll` + 手動マッチが必要になり Effect の恩恵を失う。

## 2. サービス層

サービスは `Effect.Effect<T, ErrorA | ErrorB>` を返す。現在と同じ構造だが、
エラーが `Data.TaggedError` になる。

```typescript
// electron/module/vrchatPhotoMetadata/service.ts

// extractMetadataFromPhoto は 3 種類のエラーを返しうる
export const extractMetadataFromPhoto = (
  photoPath: string,
): Effect.Effect<VRChatPhotoMetadata, MetadataDbError | NoMetadataFound | MetadataParseError> => {
  return Effect.gen(function* () {
    const exifData = yield* Effect.tryPromise({
      try: () => readExif(photoPath),
      catch: (e) => new MetadataDbError({
        // message はデバッグ用（Sentry ログに出る）。ユーザーには見えない
        message: `Failed to read EXIF: ${e instanceof Error ? e.message : String(e)}`,
      }),
    });
    return yield* parsePhotoMetadata(exifData, photoPath);
  });
};

// getMetadataForPhoto は DB エラーのみ返す
export const getMetadataForPhoto = (
  photoPath: string,
): Effect.Effect<VRChatPhotoMetadata | null, MetadataDbError> => {
  return Effect.tryPromise({
    try: () => getPhotoMetadataByPhotoPath(photoPath),
    catch: (e) => new MetadataDbError({
      message: `Failed to get metadata: ${e instanceof Error ? e.message : String(e)}`,
    }),
  }).pipe(
    Effect.map((record) => record ? toMetadata(record) : null),
  );
};
```

## 3. tRPC 実行境界: `runEffect`

```typescript
// electron/lib/effectTRPC.ts
import { Cause, Effect, Exit, Option } from 'effect';
import { TRPCError } from '@trpc/server';
import type { UserFacingError } from './errors';

/**
 * Effect<T, UserFacingError> を tRPC procedure 内で実行する。
 *
 * E チャネルの UserFacingError を TRPCError.cause に格納して throw する。
 * これにより tRPC の errorFormatter の findUserFacingError が発見できる。
 * また trpc.ts の logError が UserFacingError を instanceof で検出し、
 * 適切な Toast メッセージを emit する（このフローは維持される）。
 *
 * Defect（予期しないエラー）はそのまま re-throw（Sentry 送信）。
 *
 * 呼び出し側は、この関数に渡す前に Effect.catchTag / Effect.mapError で
 * すべてのドメインエラーを UserFacingError に変換する必要がある。
 * 型制約により、UserFacingError 以外のエラーが E チャネルに残っていると
 * コンパイルエラーになる。
 *
 * 注意: Cause が Sequential/Parallel の場合（Effect.all 等で複数エラーが
 * 並列発生した場合）、最初のエラーのみ処理する。複数エラーの並列実行は
 * 現時点でスコープ外。
 */
export async function runEffect<T>(
  effect: Effect.Effect<T, UserFacingError>,
): Promise<T> {
  const exit = await Effect.runPromiseExit(effect);

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  const failOpt = Cause.failureOption(exit.cause);
  if (Option.isSome(failOpt)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: failOpt.value.message,
      cause: failOpt.value,
    });
  }

  // Defect は re-throw して Sentry で捕捉
  const dieOpt = Cause.dieOption(exit.cause);
  if (Option.isSome(dieOpt)) {
    throw dieOpt.value;
  }

  throw new Error('Effect was interrupted or failed with an unknown cause');
}
```

### 型制約のポイント

`runEffect` は `Effect<T, UserFacingError>` のみ受け付ける。
コントローラーで `catchTag` / `mapError` し忘れると**コンパイルエラー**になる。

```typescript
// ❌ コンパイルエラー: MetadataDbError は UserFacingError ではない
runEffect(metadataService.getMetadataForPhoto(path))

// ✅ OK: すべてのエラーが UserFacingError に変換されている
runEffect(
  metadataService.getMetadataForPhoto(path).pipe(
    Effect.mapError((e) => UserFacingError.withStructuredInfo({ ... })),
  ),
)
```

### logError / Toast フローの維持

`runEffect` が throw する `TRPCError` は `.cause` に `UserFacingError` を持つ。
tRPC の `errorHandler` ミドルウェアが `result.error.cause` を `logError` に渡し、
`logError` 内部の `P.instanceOf(UserFacingError)` マッチで Toast が emit される。
このフローは現在と同じ構造なので変更不要。

`logError` は `UserFacingError` を受け取った場合も `logger.error()` を呼ぶが、
これは Sentry への通知目的で意図的な動作。ユーザー向けエラーであっても
発生頻度のモニタリングは有用なため、このまま維持する。

## 4. コントローラー: 宣言的エラー変換

### 例 1: 単一エラー型のサービス

```typescript
// getMetadataForPhoto は MetadataDbError のみ返す
getPhotoMetadata: procedure
  .input(z.object({ photoPath: z.string().min(1) }))
  .query(({ input }) =>
    runEffect(
      metadataService.getMetadataForPhoto(input.photoPath).pipe(
        // MetadataDbError → UserFacingError に変換
        // e.message はデバッグ用（Sentry ログに記録される）
        // cause: e により logger.error が元エラーを Sentry に送信する
        Effect.mapError((e) =>
          UserFacingError.withStructuredInfo({
            code: ERROR_CODES.DATABASE_ERROR,
            category: ERROR_CATEGORIES.DATABASE_ERROR,
            message: e.message,
            userMessage: '写真メタデータの取得中にエラーが発生しました。',
            cause: e,
          }),
        ),
      ),
    ),
  ),
```

### 例 2: 複数エラー型 + silent error

```typescript
// extractMetadataFromPhoto は MetadataDbError | NoMetadataFound | MetadataParseError を返す
extractPhotoMetadata: procedure
  .input(z.object({ photoPath: z.string().min(1) }))
  .mutation(({ input }) =>
    runEffect(
      metadataService.extractMetadataFromPhoto(input.photoPath).pipe(
        // 予期されたエラー → null に変換（silent、Sentry にも送らない）
        // catchTag 後、型から NoMetadataFound, MetadataParseError が消える
        Effect.catchTag("NoMetadataFound", () => Effect.succeed(null)),
        Effect.catchTag("MetadataParseError", () => Effect.succeed(null)),
        // 残った MetadataDbError → UserFacingError（cause 付きで Sentry 送信対象）
        Effect.mapError((e) =>
          UserFacingError.withStructuredInfo({
            code: ERROR_CODES.DATABASE_ERROR,
            category: ERROR_CATEGORIES.DATABASE_ERROR,
            message: e.message,
            userMessage: '写真メタデータの取得中にエラーが発生しました。',
            cause: e,
          }),
        ),
      ),
    ),
  ),
```

### 例 3: 複数エラー型で個別メッセージが必要な場合

E チャネルに複数のエラー型が残っている場合、`mapError` 内で
ts-pattern の `match` + `.exhaustive()` を使って個別にマッピングする。
**`.otherwise()` は使わない** — 新しいエラー型が追加されたとき
コンパイルエラーで検出できるようにする（ts-pattern.md のルール準拠）。

```typescript
// imageGenerator は複数の ImageGenerationError サブタイプを返す
generateSharePreview: procedure
  .input(z.object({ ... }))
  .mutation(({ input }) =>
    runEffect(
      generateSharePreview(input).pipe(
        Effect.mapError((e) =>
          match(e)
            .with({ _tag: 'SvgRenderFailed' }, (err) =>
              UserFacingError.withStructuredInfo({
                code: ERROR_CODES.UNKNOWN,
                category: ERROR_CATEGORIES.UNKNOWN_ERROR,
                message: err.message,
                userMessage: '画像の生成に失敗しました。',
              }),
            )
            .with({ _tag: 'FontLoadFailed' }, (err) =>
              UserFacingError.withStructuredInfo({
                code: ERROR_CODES.FILE_NOT_FOUND,
                category: ERROR_CATEGORIES.FILE_NOT_FOUND,
                message: err.message,
                userMessage: 'フォントの読み込みに失敗しました。',
              }),
            )
            // exhaustive() により、新しいエラー型追加時にコンパイルエラーで検出
            .exhaustive(),
        ),
      ),
    ),
  ),
```

### silent error で `null` vs 空コレクション

| 戻り値型 | silent error 時の戻り値 | 理由 |
|---------|----------------------|------|
| `T \| null` | `null` | 単一オブジェクト取得系 |
| `T[]` | `[]` | リスト取得系（空リストは正常） |
| `Map<K, V>` | `new Map()` | マップ取得系（空マップは正常） |

コレクション型の場合は `null` ではなく空コレクションを返す。
呼び出し側が `null` チェックなしで `.map()` や `.entries()` を呼べるようにする。

### 現在の `runEffectForTRPC` との比較

| 観点 | 現在 (`runEffectForTRPC`) | 新 (`runEffect` + pipe) |
|------|---------------------------|-------------------------|
| エラーマッピング | 辞書オブジェクト（文字列キー） | `Effect.mapError`（型安全） |
| silent error | `options.silentErrors` 配列 | `Effect.catchTag` → `succeed(null)` |
| 型安全性 | ランタイムの文字列マッチ | コンパイル時の型チェック |
| 網羅性 | 保証なし（default fallback） | 未処理エラーが型に残る |
| throw | `runEffectForTRPC` 内で throw | `runEffect` 内で `TRPCError` として throw |

## 5. 廃止されるもの

| ファイル/概念 | 理由 |
|-------------|------|
| `effectHelpers.ts` の `runEffectForTRPC` | 新 `runEffect` に置き換え |
| `errorHelpers.ts` のマッピング辞書群 | `pipe` 内の `mapError` に置き換え |
| `errorHelpers.ts` の `getErrorKey` | `_tag` で自動判別されるため不要 |
| `silentErrors` 配列 | `catchTag` で明示的に処理 |
| エラークラスの `code` フィールド | 1 クラス = 1 エラーなので不要 |

## 6. 維持されるもの

| コンポーネント | 理由 |
|-------------|------|
| `UserFacingError` クラス | ユーザー向けメッセージの構造体として有用 |
| `ERROR_CODES` / `ERROR_CATEGORIES` | フロントエンドの `parseErrorFromTRPC` が依存 |
| `findUserFacingError` (trpc.ts) | `TRPCError.cause` から発見可能なのでそのまま動く |
| `logError` + Toast emit (trpc.ts) | `UserFacingError` の instanceof チェックで動作。変更不要 |
| `parseErrorFromTRPC` (frontend) | 変更不要 |
| Toast subscription | 変更不要 |

## 7. エラーフロー図

```
Service                     Controller (pipe)          tRPC boundary
─────────────────────────  ─────────────────────────  ────────────────────
Effect<T,                  .pipe(
  MetadataDbError            catchTag("NoMeta..")
  | NoMetadataFound           → succeed(null)         型から消える ✓
  | MetadataParseError        catchTag("ParseErr")
>                             → succeed(null)         型から消える ✓
                              mapError(DbError →
                                UserFacingError)       型が変換される ✓
                           )

                           Effect<T | null,            runEffect(effect)
                             UserFacingError>          Exit 検査
                                                       ↓
                                                       UserFacingError を
                                                       TRPCError.cause に
                                                       ↓
                                                       errorHandler MW
                                                       logError() 呼び出し
                                                       ↓
                                                       UserFacingError →
                                                       Toast emit ✓
                                                       ↓
                                                       errorFormatter
                                                       structuredError ✓
                                                       ↓
                                                       Frontend Toast ✓
```

## 8. Sentry 送信設計

### エラー種別と Sentry 送信の対応

| エラー種別 | 例 | Sentry 送信 | 仕組み |
|-----------|-----|-----------|--------|
| **Defect（予期しない）** | 型エラー、メモリ不足 | **送信する** | `runEffect` が re-throw → `logger.error(Error)` → `captureException` |
| **予期された + 重要** | DB 障害、ファイル書込失敗 | **送信する** | `mapError(e => UFE({ cause: e }))` → `logger.error(UFE with cause)` → cause を `captureException` |
| **予期された + 軽微** | ファイル未検出、キャンセル | **送信しない** | `mapError(e => UFE({ cause: e }))` → `logger.error(UFE with cause)` → cause を送信。ただしビジネス判断で cause を省略可 |
| **Silent（正常系）** | メタデータなし、パースエラー | **送信しない** | `catchTag → succeed(null)` → エラーにならない |
| **監視対象の警告** | API レート制限、部分的失敗 | **warning で送信** | サービス内で `logger.warnWithSentry()` を直接呼ぶ |

### `cause` フィールドの判断基準

`mapError` で `UserFacingError` を作る際の `cause` フィールドの扱い：

```typescript
// ✅ 重要なエラー: cause を付けて Sentry に送信
Effect.mapError((e) =>
  UserFacingError.withStructuredInfo({
    code: ERROR_CODES.DATABASE_ERROR,
    message: e.message,
    userMessage: 'DB エラーが発生しました。',
    cause: e,  // ← logger.error が cause を Sentry に送信
  }),
),

// ✅ 軽微なエラー: cause を省略して Sentry に送信しない
Effect.mapError((e) =>
  UserFacingError.withStructuredInfo({
    code: ERROR_CODES.FILE_NOT_FOUND,
    message: e.message,
    userMessage: 'ファイルが見つかりません。',
    // cause を省略 → logger.error は Sentry に送信しない
  }),
),
```

**ルール**:
- DB エラー、ネットワークエラー、権限エラー → `cause: e`（Sentry 送信）
- ファイル未検出、ユーザーキャンセル → `cause` 省略可（Sentry 不要）
- 判断に迷ったら `cause: e` を付ける（過剰な送信は Sentry 側でフィルタ可能）

### `logger.warnWithSentry()` は維持

サービス層で「エラーにはしないが本番で監視したい」ケースは、
Effect の E チャネルとは独立に `logger.warnWithSentry()` を直接呼ぶ。

```typescript
// サービス内: 一部のログファイルが処理失敗した（全体は成功）
if (partialFailures.length > 0) {
  logger.warnWithSentry({
    message: `Failed to process ${partialFailures.length} log files`,
    details: { errors: partialFailures },
  });
}
```

これは Effect のエラーフローとは別のパスなので、新設計の影響を受けない。

## 9. Lint による設計強制

設計ルールを lint で自動検出し、CI で強制する。
実装は TypeScript Compiler API ベースのカスタム lint（既存の `lint-ts-pattern.ts` 等と同じ方式）。

### lint-effect.ts に追加するルール

| ルール名 | 検出対象 | 重要度 | 検出方法 |
|---------|---------|--------|---------|
| `no-effect-fail-userfacingerror` | `Effect.fail(UserFacingError.withStructuredInfo(...))` | error | AST: `Effect.fail` の引数が `UserFacingError` のコンストラクタ呼び出し |
| `no-throw-in-effect-gen` | `Effect.gen` 内での `throw UserFacingError` | error | AST: `Effect.gen` のジェネレータ関数内の throw 文で `UserFacingError` を検出 |
| `no-legacy-error-class-code` | `class XxxError extends Error { code: ... }` パターン | error | AST: Error を extends するクラスに `code` プロパティがあるか（移行完了後に有効化） |
| `require-cause-in-mapError` | `mapError` 内の `UserFacingError.withStructuredInfo` に `cause` なし | warning | AST: `Effect.mapError` コールバック内の `withStructuredInfo` 引数オブジェクトに `cause` プロパティがないか |
| `no-mock-resolved-effect` | `mockResolvedValue(Effect.succeed(...))` | error | AST/テキスト: `mockResolvedValue` の引数に `Effect.succeed`/`Effect.fail` |
| `no-neverthrow-import` | `from 'neverthrow'` | error | テキスト: 既存ルール（維持） |
| `no-runEffectForTRPC` | `runEffectForTRPC` の使用 | error | テキスト: 移行完了後に有効化 |

### TypeScript 型システムで自動強制されるルール（lint 不要）

| ルール | 強制方法 |
|-------|---------|
| `runEffect` は `Effect<T, UserFacingError>` のみ受け付ける | ジェネリクス型制約 |
| `catchTag` で処理したエラーは型から消える | Effect の型推論 |
| `mapError` 後に未処理エラーが残ると `runEffect` でコンパイルエラー | TypeScript の型チェック |
| `Data.TaggedError` には `_tag` が自動付与される | Effect の型定義 |

### Grit パターン（将来的に追加可能）

| パターン名 | 検出対象 |
|-----------|---------|
| `effect_fail_userfacing` | `Effect.fail(new UserFacingError(...))` or `Effect.fail(UserFacingError.withStructuredInfo(...))` |
| `effect_gen_throw` | generator function 内の `throw` 文 |

### 段階的な有効化

1. **移行中**: `no-neverthrow-import`, `no-mock-resolved-effect`, `no-effect-fail-userfacingerror` を error で有効化
2. **移行完了後**: `no-legacy-error-class-code`, `no-runEffectForTRPC` を error で有効化
3. **常時**: `require-cause-in-mapError` を warning で有効化（意図的な cause 省略は `// lint-ignore` コメントで明示）

## 10. 移行戦略

1. `runEffect` を `effectTRPC.ts` に作成
2. `Data.TaggedError` 版のエラー型を各モジュールに作成
3. サービス層のエラー生成を新エラー型に変更
4. コントローラーを `runEffect` + `pipe` パターンに順次変更
5. 全テスト通過後、`runEffectForTRPC` / マッピング辞書を削除
6. `error-handling.md` を更新

段階的に移行可能。**1 モジュールずつ変更してテストを通せる。**

### 移行中の混在に関する制約

新エラー型（`Data.TaggedError`、`_tag` を持つ）を使うモジュールは、
同時に `runEffect` への切り替えも行う。
旧 `runEffectForTRPC` の `getErrorKey` は `_tag` を見ないため、
新エラー型を旧ヘルパーで使うと正しくマッピングされない。

**ルール: 1 モジュール = エラー型 + サービス + コントローラーをセットで移行する。混在させない。**

## 11. テスト戦略

テストは 4 層で設計する。各層が独立して検証可能であること。

### 11.1. Lint ルールのテスト

各 lint ルールに対してテストフィクスチャを作成し、検出精度を検証する。
既存の `lint-ts-pattern.test.ts` と同じパターン。

```typescript
// scripts/lint-effect.test.ts

describe('no-effect-fail-userfacingerror', () => {
  it('Effect.fail(UserFacingError.withStructuredInfo(...)) を検出する', () => {
    const code = `
      import { Effect } from 'effect';
      import { UserFacingError } from './errors';
      const x = Effect.fail(UserFacingError.withStructuredInfo({ ... }));
    `;
    const result = linter.lint(code);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].rule).toBe('no-effect-fail-userfacingerror');
  });

  it('Effect.fail(new DomainError(...)) は許可する', () => {
    const code = `
      import { Effect } from 'effect';
      const x = Effect.fail(new DbError({ message: 'test' }));
    `;
    const result = linter.lint(code);
    expect(result.issues).toHaveLength(0);
  });
});

describe('no-throw-in-effect-gen', () => {
  it('Effect.gen 内の throw UserFacingError を検出する', () => {
    const code = `
      import { Effect } from 'effect';
      const x = Effect.gen(function* () {
        throw UserFacingError.withStructuredInfo({ ... });
      });
    `;
    const result = linter.lint(code);
    expect(result.issues).toHaveLength(1);
  });

  it('Effect.gen 内の throw Error（defect）は許可する', () => {
    const code = `
      import { Effect } from 'effect';
      const x = Effect.gen(function* () {
        throw new Error('unexpected');
      });
    `;
    const result = linter.lint(code);
    expect(result.issues).toHaveLength(0);
  });
});

describe('require-cause-in-mapError', () => {
  it('mapError 内の withStructuredInfo に cause がないと警告', () => {
    const code = `
      effect.pipe(
        Effect.mapError((e) =>
          UserFacingError.withStructuredInfo({
            code: ERROR_CODES.DATABASE_ERROR,
            message: e.message,
            userMessage: 'エラー',
          }),
        ),
      );
    `;
    const result = linter.lint(code);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('warning');
  });

  it('cause: e があれば OK', () => {
    const code = `
      effect.pipe(
        Effect.mapError((e) =>
          UserFacingError.withStructuredInfo({
            code: ERROR_CODES.DATABASE_ERROR,
            message: e.message,
            userMessage: 'エラー',
            cause: e,
          }),
        ),
      );
    `;
    const result = linter.lint(code);
    expect(result.issues).toHaveLength(0);
  });
});

describe('no-mock-resolved-effect', () => {
  it('mockResolvedValue(Effect.succeed(...)) を検出する', () => {
    const code = `
      vi.fn().mockResolvedValue(Effect.succeed(42));
    `;
    const result = linter.lint(code);
    expect(result.issues).toHaveLength(1);
  });

  it('mockReturnValue(Effect.succeed(...)) は許可する', () => {
    const code = `
      vi.fn().mockReturnValue(Effect.succeed(42));
    `;
    const result = linter.lint(code);
    expect(result.issues).toHaveLength(0);
  });
});
```

### 11.2. `runEffect` のユニットテスト

`runEffect` の各エラーパスを網羅的にテストする。

```typescript
// electron/lib/effectTRPC.test.ts

describe('runEffect', () => {
  describe('成功パス', () => {
    it('Effect が成功した場合、値を返す', async () => {
      const result = await runEffect(Effect.succeed(42));
      expect(result).toBe(42);
    });
  });

  describe('typed error パス（UserFacingError）', () => {
    it('E チャネルの UserFacingError を TRPCError.cause に格納して throw', async () => {
      const userFacingError = UserFacingError.withStructuredInfo({
        code: ERROR_CODES.DATABASE_ERROR,
        category: ERROR_CATEGORIES.DATABASE_ERROR,
        message: 'db failed',
        userMessage: 'DB エラー',
      });

      try {
        await runEffect(Effect.fail(userFacingError));
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).cause).toBeInstanceOf(UserFacingError);
        expect((error as TRPCError).cause).toBe(userFacingError);
      }
    });

    it('throw された TRPCError を findUserFacingError で発見できる', async () => {
      const userFacingError = UserFacingError.withStructuredInfo({
        code: ERROR_CODES.DATABASE_ERROR,
        category: ERROR_CATEGORIES.DATABASE_ERROR,
        message: 'db failed',
        userMessage: 'DB エラー',
      });

      try {
        await runEffect(Effect.fail(userFacingError));
      } catch (error) {
        // tRPC の findUserFacingError と同じロジックで発見できることを検証
        const found = findUserFacingError((error as TRPCError).cause);
        expect(found).toBe(userFacingError);
      }
    });
  });

  describe('defect パス（予期しないエラー）', () => {
    it('Effect.die のエラーをそのまま re-throw する', async () => {
      const unexpectedError = new Error('memory exhausted');

      await expect(
        runEffect(Effect.die(unexpectedError) as Effect.Effect<never, UserFacingError>),
      ).rejects.toBe(unexpectedError);
    });
  });

  describe('interrupt パス', () => {
    it('interrupt の場合は汎用エラーを throw する', async () => {
      await expect(
        runEffect(Effect.interrupt as Effect.Effect<never, UserFacingError>),
      ).rejects.toThrow('Effect was interrupted');
    });
  });
});
```

### 11.3. Sentry 送信パスの統合テスト

`logger.error` → Sentry `captureException` の呼び出しを検証する。
Sentry SDK をモックして、各エラー種別で正しく送信/非送信されるか確認。

```typescript
// electron/lib/logger.sentry.test.ts

// Sentry モック
vi.mock('@sentry/electron/main', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

describe('Sentry 送信パス', () => {
  it('通常の Error は Sentry に送信される', () => {
    logger.error({
      message: 'unexpected error',
      stack: new Error('connection lost'),
    });
    expect(captureException).toHaveBeenCalled();
  });

  it('UserFacingError with cause は cause が Sentry に送信される', () => {
    const cause = new Error('original db error');
    const ufe = UserFacingError.withStructuredInfo({
      code: ERROR_CODES.DATABASE_ERROR,
      category: ERROR_CATEGORIES.DATABASE_ERROR,
      message: 'db error',
      userMessage: 'DB エラー',
      cause,
    });
    logger.error({ message: ufe.message, stack: ufe });
    // cause が captureException に渡されることを検証
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'original db error' }),
    );
  });

  it('UserFacingError without cause は Sentry に送信されない', () => {
    const ufe = UserFacingError.withStructuredInfo({
      code: ERROR_CODES.FILE_NOT_FOUND,
      category: ERROR_CATEGORIES.FILE_NOT_FOUND,
      message: 'file not found',
      userMessage: 'ファイルが見つかりません',
      // cause なし
    });
    logger.error({ message: ufe.message, stack: ufe });
    expect(captureException).not.toHaveBeenCalled();
  });

  it('logger.warnWithSentry は warning レベルで Sentry に送信される', () => {
    logger.warnWithSentry({
      message: 'partial failure',
      details: { count: 3 },
    });
    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('partial failure'),
      expect.objectContaining({ level: 'warning' }),
    );
  });
});
```

### 11.4. サービス層・コントローラー層のテスト

#### サービス層

```typescript
// electron/module/vrchatPhotoMetadata/service.test.ts

describe('getMetadataForPhoto', () => {
  it('DB エラー時に MetadataDbError を返す', async () => {
    // DB モックをエラーにする
    vi.mocked(getPhotoMetadataByPhotoPath).mockRejectedValue(
      new Error('connection refused'),
    );

    const exit = await Effect.runPromiseExit(
      metadataService.getMetadataForPhoto('test.png'),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
      expect(Option.isSome(error)).toBe(true);
      if (Option.isSome(error)) {
        // Data.TaggedError の _tag で判別
        expect(error.value._tag).toBe('MetadataDbError');
        expect(error.value.message).toContain('connection refused');
      }
    }
  });
});
```

#### コントローラー層

```typescript
// electron/module/vrchatPhotoMetadata/vrchatPhotoMetadata.controller.test.ts

describe('getPhotoMetadata', () => {
  it('DB エラー時に TRPCError(cause: UserFacingError) を throw する', async () => {
    // サービスモックを DB エラーにする
    vi.mocked(metadataService.getMetadataForPhoto).mockReturnValue(
      Effect.fail(new MetadataDbError({ message: 'connection refused' })),
    );

    await expect(
      router.getPhotoMetadata({ input: { photoPath: 'test.png' }, ... }),
    ).rejects.toThrow('写真メタデータの取得中にエラーが発生しました。');
  });

  it('NoMetadataFound は null を返す（silent error）', async () => {
    vi.mocked(metadataService.extractMetadataFromPhoto).mockReturnValue(
      Effect.fail(new NoMetadataFound({ photoPath: 'test.png' })),
    );

    const result = await router.extractPhotoMetadata({
      input: { photoPath: 'test.png' }, ...
    });
    expect(result).toBeNull();
  });
});
```

### テストカバレッジの判断基準

| テスト対象 | 必須テスト | 理由 |
|-----------|-----------|------|
| lint ルール | 正検出 + 偽陽性の非検出 | lint が壊れると設計ルールが崩れる |
| `runEffect` | 成功/typed error/defect/interrupt | tRPC 境界の唯一の実行ポイント |
| Sentry 送信パス | cause あり/なし/warnWithSentry | 監視の要。誤送信・未送信は致命的 |
| サービス層 | エラー型の `_tag` 検証 | `catchTag` の前提条件 |
| コントローラー層 | silent error + UserFacingError 変換 | ユーザー体験に直結 |
