# 堅牢性設計ガイドライン

このドキュメントは、コードの堅牢性を確保するための設計原則とコーディング規約を定義します。

---

## 基本理念

### Design for Correctness（正しさのための設計）

**テストで正しさを検証するのではなく、設計によって正しさを保証する。**

| アプローチ | 説明 | 優先度 |
|-----------|------|--------|
| 型による保証 | コンパイル時に不正な状態を検出 | 最優先 |
| 静的解析 | linterやTypeScriptの厳格な設定で問題を早期発見 | 高 |
| ランタイム検証 | Zodによる境界でのバリデーション | 中 |
| テスト | 上記で保証できない振る舞いの検証 | 補完的 |

```
「動かないコードは書けない」設計 > 「動かないコードを見つける」テスト
```

### シンプルさと堅牢性の両立

堅牢性のために複雑さを導入するのではなく、**シンプルな設計で堅牢性を達成する**ことを目指す。

- 不要な抽象化を避ける
- 明示的で予測可能なコードを書く
- 型システムを活用して暗黙の契約を明示する

---

## 型安全性ツールの活用

### 1. ts-pattern（パターンマッチング）

**使用目的**: 条件分岐の型安全性とexhaustive checking

```typescript
import { match, P } from 'ts-pattern';

// ✅ Good: exhaustive checkingによる網羅性保証
type Status = 'pending' | 'running' | 'completed' | 'failed';

const getStatusMessage = (status: Status): string =>
  match(status)
    .with('pending', () => '待機中')
    .with('running', () => '実行中')
    .with('completed', () => '完了')
    .with('failed', () => '失敗')
    .exhaustive(); // 新しいstatusが追加されたらコンパイルエラー

// ✅ Good: 複雑なオブジェクトのパターンマッチ
match(result)
  .with({ isOk: true }, ({ value }) => handleSuccess(value))
  .with({ isErr: true, error: { type: 'NOT_FOUND' } }, () => handleNotFound())
  .with({ isErr: true, error: { type: 'TIMEOUT' } }, () => handleTimeout())
  .otherwise(() => handleUnexpected());
```

**使用すべき場面**:
- Union型の分岐処理
- エラーハンドリング
- 状態遷移の処理
- 複数条件の組み合わせ判定

**例外（通常のif文でよい場合）**:
- 単純なboolean判定（`if (isLoading)`）
- null/undefinedチェックのみ

### 2. Zod（スキーマバリデーション）

**使用目的**: 外部境界でのランタイム検証と型推論

```typescript
import { z } from 'zod';

// ✅ Good: スキーマから型を導出
const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['admin', 'user', 'guest']),
});

type User = z.infer<typeof UserSchema>;

// ✅ Good: 外部入力の検証
const parseUser = (input: unknown): User => {
  return UserSchema.parse(input); // 失敗時はZodError
};

// ✅ Good: 安全なパース（Result型との組み合わせ）
const safeParseUser = (input: unknown): Result<User, ValidationError> => {
  const result = UserSchema.safeParse(input);
  if (result.success) {
    return ok(result.data);
  }
  return err({ type: 'VALIDATION_ERROR', issues: result.error.issues });
};
```

**使用すべき場面**:
- API境界（tRPCのinput/output）
- ファイル読み込み後のデータ検証
- 設定ファイルのパース
- ユーザー入力の検証

### 3. Zod Branded Types（公称型）

**使用目的**: プリミティブ型の意味的な区別

```typescript
// ✅ Good: Branded Typeで意味を明確化
const UserIdSchema = z.string().uuid().brand<'UserId'>();
const PhotoIdSchema = z.string().uuid().brand<'PhotoId'>();

type UserId = z.infer<typeof UserIdSchema>;
type PhotoId = z.infer<typeof PhotoIdSchema>;

// コンパイル時に混同を防止
function getPhoto(photoId: PhotoId): Photo { ... }

const userId: UserId = UserIdSchema.parse('...');
const photoId: PhotoId = PhotoIdSchema.parse('...');

getPhoto(photoId);  // ✅ OK
getPhoto(userId);   // ❌ コンパイルエラー！
```

**使用すべき場面**:
- ID型（UserId, PhotoId, WorldId など）
- パス型（絶対パス、相対パス）
- 検証済みの値（ValidatedEmail, NormalizedPath など）

### 4. BaseValueObject パターン

プロジェクト固有のValueObjectパターンを使用する場合:

```typescript
// 型のみをエクスポート
class MyValueObject extends BaseValueObject<'MyValueObject', string> {}
export type { MyValueObject };  // ✅ 型のみ

// Zodスキーマ経由でインスタンス生成
export const MyValueObjectSchema = z.string().transform(
  (val) => new MyValueObject(val)
);

// 使用側
const obj = MyValueObjectSchema.parse(value);  // ✅ 正しい
const obj = new MyValueObject(value);          // ❌ 直接newは禁止
```

---

## 静的解析の活用

### TypeScript設定

`tsconfig.json` で厳格な設定を使用:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true
  }
}
```

### カスタムlinterの活用

| コマンド | 目的 |
|---------|------|
| `pnpm lint:neverthrow` | Result型の正しい使用を検証 |
| `pnpm lint:valueobjects` | ValueObjectパターンの遵守を検証 |
| `pnpm lint:ts-pattern` | ts-patternの適切な使用を検証 |

---

## 設計パターン

### 不正な状態を表現不可能にする

```typescript
// ❌ Bad: 不正な状態が表現可能
interface LoadingState {
  isLoading: boolean;
  data: Data | null;
  error: Error | null;
}
// isLoading=true かつ data!=null かつ error!=null という状態が可能

// ✅ Good: 不正な状態が型レベルで表現不可能
type LoadingState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: Data }
  | { status: 'error'; error: Error };
```

### Parse, Don't Validate

```typescript
// ❌ Bad: 検証後も型が変わらない
function processEmail(email: string): void {
  if (!isValidEmail(email)) {
    throw new Error('Invalid email');
  }
  // email は依然として string 型
  sendEmail(email);
}

// ✅ Good: 検証と型変換を同時に行う
const EmailSchema = z.string().email().brand<'Email'>();
type Email = z.infer<typeof EmailSchema>;

function processEmail(input: string): Result<void, ValidationError> {
  const emailResult = EmailSchema.safeParse(input);
  if (!emailResult.success) {
    return err({ type: 'VALIDATION_ERROR' });
  }
  // emailResult.data は Email 型（検証済みであることが型で保証）
  return sendEmail(emailResult.data);
}
```

### 早期リターンと型の絞り込み

```typescript
// ✅ Good: 早期リターンで型を絞り込む
function processUser(user: User | null): Result<ProcessedUser, Error> {
  if (!user) {
    return err({ type: 'USER_NOT_FOUND' });
  }
  // ここ以降、user は User 型（nullでないことが保証）

  if (!user.isActive) {
    return err({ type: 'USER_INACTIVE' });
  }
  // ここ以降、user.isActive は true（アクティブであることが保証）

  return ok(processActiveUser(user));
}
```

---

## 優先順位の判断基準

堅牢性とシンプルさがトレードオフになる場合の判断基準:

| 状況 | 推奨アプローチ |
|------|---------------|
| 外部入力（API、ファイル） | 堅牢性優先（Zod必須） |
| 内部のドメインロジック | 型による保証 + ts-pattern |
| ID型の混同リスク | Branded Types |
| 状態遷移 | Union型 + exhaustive matching |
| 単純なユーティリティ | シンプルさ優先 |

---

## アンチパターン

### 1. any/unknownの安易な使用

```typescript
// ❌ Bad
function process(data: any): void { ... }

// ✅ Good
function process(data: unknown): Result<ProcessedData, ParseError> {
  const parsed = DataSchema.safeParse(data);
  ...
}
```

### 2. 型アサーション（as）の濫用

```typescript
// ❌ Bad
const user = response.data as User;

// ✅ Good
const userResult = UserSchema.safeParse(response.data);
```

### 3. オプショナルチェーンの過剰使用

```typescript
// ❌ Bad: nullableが伝播して型が曖昧に
const name = user?.profile?.settings?.displayName ?? 'Unknown';

// ✅ Good: 明示的なnullチェックと早期リターン
if (!user) return err({ type: 'USER_NOT_FOUND' });
if (!user.profile) return err({ type: 'PROFILE_NOT_FOUND' });
return ok(user.profile.settings.displayName);
```

---

## 関連ドキュメント

- `.claude/rules/error-handling.md` - エラーハンドリングの詳細
- `docs/lint-neverthrow.md` - neverthrowリンターの使用方法
