# try-catch → Effect TS 完全移行プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** electron/ 内の try-catch を Effect TS のネイティブパターンに置き換え、エラーが型チャネルで伝播する設計に統一する

**Architecture:** 現在の `async function → try-catch → throw` パターンを `() => Effect.Effect<T, E>` に変換する。ヘルパー関数は Effect を返し、エラーは E チャネルで伝播させ、tRPC procedure 境界で `runEffect` により TRPCError に変換する。

**Tech Stack:** Effect TS (Effect.gen, Effect.tryPromise, Data.TaggedError, yield*, catchTag, mapError)

---

## 根本方針: Effect TS のエラーハンドリングプラクティス

### ❌ 現在の誤ったパターン

```typescript
// 関数が Promise を返し、内部で Effect を手動実行して throw
const findSomething = async (id: string) => {
  const result = await runEffectExit(
    Effect.tryPromise({
      try: () => dbQuery(id),
      catch: (e) => new UserFacingError(...)
    })
  );
  if (!result.success) throw result.error;  // ← try-catch と同じ
  return result.value;
};
```

### ✅ 正しい Effect TS パターン

```typescript
// 関数が Effect を返し、エラーは E チャネルで伝播
const findSomething = (id: string): Effect.Effect<Data, DbError> =>
  Effect.tryPromise({
    try: () => dbQuery(id),
    catch: (e): DbError => new DbError({ message: String(e) }),
  });

// tRPC procedure 境界でのみ runEffect
procedure.query(({ input }) =>
  runEffect(
    findSomething(input.id).pipe(
      Effect.mapError((e) => UserFacingError.withStructuredInfo({...}))
    )
  )
),
```

### キー原則

1. **関数は Effect を返す**: `async () => Promise<T>` ではなく `() => Effect.Effect<T, E>`
2. **エラーは E チャネル**: `throw` ではなく `Effect.fail()` / `yield* new TaggedError()`
3. **yield* で合成**: `await` ではなく `yield*` で Effect をチェーン
4. **tRPC 境界で実行**: `runEffect()` は tRPC procedure のみ。ヘルパーは Effect を返す
5. **予期しないエラーは defect**: `throw` で Sentry 送信。E チャネルに入れない

---

## 対象分類

### Group A: Effect を返すよう関数シグネチャを変更（本質的な変換）

これらは `async → Promise<T>` を `() → Effect.Effect<T, E>` に変える必要がある。

| ファイル | 関数 | 現状 | 変換内容 |
|---------|------|------|---------|
| logInfoCointroller.ts | `findRecentMergedWorldJoinLog` | async + runEffectExit + throw | Effect を返す |
| logInfoCointroller.ts | `findNextMergedWorldJoinLog` | 同上 | Effect を返す |
| logInfoCointroller.ts | `getPlayerJoinListInSameWorldCore` | 同上 | Effect を返す |
| logInfoCointroller.ts | `getVRCWorldJoinLogList` | 同上 | Effect を返す |
| worldJoinImage/service.ts | 複数箇所 | Effect.gen 内の try-catch | Effect.tryPromise に統一 |

### Group B: 非Effect関数で許容（コメント維持）

これらは Effect を使わない関数で、try-catch は許容。

| ファイル | 理由 |
|---------|------|
| logger.ts, wrappedApp.ts | Electron 環境検出 |
| sequelize.ts, settingsController.ts | finally でクリーンアップ |
| trpc.ts | tRPC フレームワーク境界 |
| dbQueue.ts | コールバックベースのキューパターン |
| vrchatPhoto.service.ts:81,110 | Electron 環境検出 |
| vrchatPhoto.service.ts:344,1235 | finally クリーンアップ |
| フロントエンド (src/) | React 境界（Effect 不使用）|
| importService.ts:219 | 非Effect プレーン関数 |
| colorExtractor.ts | 非Effect ユーティリティ |

### Group C: Effect.gen 内の try-catch → Effect パターンに変換

| ファイル | 行 | 内容 |
|---------|-----|------|
| worldJoinImage/service.ts:88 | ファイル存在チェック | `Effect.tryPromise` に |
| worldJoinImage/service.ts:120 | エラー分類 | `Effect.tryPromise` + ts-pattern に |
| worldJoinImage/service.ts:144 | ダウンロードエラー | `Effect.either` パターンに |
| logSync/service.ts:119 | getSettingStore エラー | `Effect.try` に |
| migration/service.ts:150 | ファイル存在チェック | `Effect.tryPromise` に |
| migration/service.ts:183 | エラーログ＋正常終了 | `Effect.catchAll` に |
| vrchatPhoto.service.ts:715 | ディレクトリスキャン | 非Effect関数なので許容 |
| vrchatPhoto.service.ts:1328 | エラー情報補強 | 非Effect関数なので許容 |
| vrchatPhoto.service.ts:1657 | → 変換済み (runPromiseExit) | 完了 |

---

## Task 1: logInfoCointroller.ts — ヘルパー関数の Effect 化

**Files:**
- Modify: `electron/module/logInfo/logInfoCointroller.ts`
- Test: `electron/module/logInfo/logInfoCointroller.test.ts`

### 変換対象

4つのヘルパー関数を `async → Promise` から `() → Effect` に変換:

1. `getVRCWorldJoinLogList`: async → Effect
2. `findRecentMergedWorldJoinLog`: async → Effect
3. `findNextMergedWorldJoinLog`: async → Effect
4. `getPlayerJoinListInSameWorldCore`: async → Effect

### 変換パターン

```typescript
// Before:
const findRecentMergedWorldJoinLog = async (datetime: Date) => {
  const result = await runEffectExit(Effect.tryPromise({...}));
  if (!result.success) throw result.error;
  return result.value[0] ?? null;
};

// After:
const findRecentMergedWorldJoinLog = (
  datetime: Date,
): Effect.Effect<MergedWorldJoinLog | null, UserFacingError> => {
  const searchEndTime = new Date(datetime.getTime() + 1000);
  return Effect.tryPromise({
    try: () => fetchAndMergeSortedWorldJoinLogs({...}, 'desc'),
    catch: (error): UserFacingError =>
      UserFacingError.withStructuredInfo({...}),
  }).pipe(Effect.map((logs) => logs[0] ?? null));
};
```

### 呼び出し側の変更

ヘルパーが Effect を返すようになるため、呼び出し側も変更:

```typescript
// Before (async/await):
const recentWorldJoin = await findRecentMergedWorldJoinLog(datetime);

// After (Effect.gen 内):
const recentWorldJoin = yield* findRecentMergedWorldJoinLog(datetime);
```

tRPC procedure から直接呼ばれている場合は `runEffect` でラップ。

- [ ] Step 1: `getVRCWorldJoinLogList` を Effect を返す関数に変換
- [ ] Step 2: `findRecentMergedWorldJoinLog` を Effect を返す関数に変換
- [ ] Step 3: `findNextMergedWorldJoinLog` を Effect を返す関数に変換
- [ ] Step 4: `getPlayerJoinListInSameWorldCore` を Effect を返す関数に変換（呼び出す2関数も Effect 化済みなので yield* で合成）
- [ ] Step 5: 呼び出し側（tRPC procedure, 他のヘルパー）を更新
- [ ] Step 6: テスト実行 `pnpm test -- electron/module/logInfo/`
- [ ] Step 7: lint 実行 `pnpm lint:effect`
- [ ] Step 8: コミット

---

## Task 2: worldJoinImage/service.ts — Effect.gen 内の try-catch 変換

**Files:**
- Modify: `electron/module/worldJoinImage/service.ts`

3箇所の try-catch を Effect パターンに:

### 2a: ファイル存在チェック (line 88)

```typescript
// Before:
try {
  await fsPromises.access(filePath);
  return true;
} catch { return false; }

// After:
const exists = yield* Effect.tryPromise({
  try: () => fsPromises.access(filePath).then(() => true),
  catch: () => false as const,
}).pipe(Effect.merge);
// または Effect.either + match
```

### 2b: エラー分類 (line 120)

ts-pattern でエラー分類して再スロー → `Effect.tryPromise` の `catch` で分類。

### 2c: ダウンロードエラー (line 144)

ループ内で個別エラーをスキップ → `Effect.either` パターン。

- [ ] Step 1: line 88 のファイル存在チェックを変換
- [ ] Step 2: line 120 のエラー分類を変換
- [ ] Step 3: line 144 のダウンロードエラーを変換
- [ ] Step 4: allow コメントを削除
- [ ] Step 5: テスト・lint 実行
- [ ] Step 6: コミット

---

## Task 3: logSync/service.ts + migration/service.ts の try-catch 変換

**Files:**
- Modify: `electron/module/logSync/service.ts`
- Modify: `electron/module/migration/service.ts`

### logSync/service.ts:119
getSettingStore() の初期化エラー → `Effect.try` に変換。

### migration/service.ts:150
ファイル存在チェック → `Effect.tryPromise` + `Effect.either` に。

### migration/service.ts:183
エラーログ＋正常終了 → `Effect.catchAll` に変換。

- [ ] Step 1: logSync/service.ts の try-catch を変換
- [ ] Step 2: migration/service.ts:150 を変換
- [ ] Step 3: migration/service.ts:183 を変換
- [ ] Step 4: allow コメントを削除
- [ ] Step 5: テスト・lint 実行
- [ ] Step 6: コミット

---

## Task 4: lint ルールを warning → error に昇格

全ての try-catch が解決したら、`no-try-catch` ルールを error に昇格してCIで落とす。

**Files:**
- Modify: `scripts/lint-effect.ts`

- [ ] Step 1: 残存 warning が 0 であることを確認
- [ ] Step 2: severity を 'warning' → 'error' に変更（許容コメントなしの try-catch を CI で落とす）
- [ ] Step 3: lint 実行で 0 errors を確認
- [ ] Step 4: コミット

---

## スコープ外（このプランでは対応しない）

- フロントエンド (src/) の try-catch: React は Effect TS を使わないため許容
- Electron 環境検出パターン: 許容（require('electron') の try-catch）
- finally クリーンアップ: 許容（Effect.acquireRelease への変換は別タスク）
- dbQueue.ts: コールバックベースのため許容
- 非Effect プレーン関数（importService, colorExtractor 等）: Effect 化は別タスク
