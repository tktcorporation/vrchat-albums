# 堅牢性設計ガイドライン

## 基本理念: Design for Correctness

**優先順位**: 型による保証 > 静的解析 > ランタイム検証 > テスト

「動かないコードは書けない」設計 > 「動かないコードを見つける」テスト

---

## ts-pattern（パターンマッチング）

**すべての条件分岐で `match()` + `exhaustive()` を使用する。** if文への書き換え禁止。

```typescript
import { match, P } from 'ts-pattern';

// exhaustive checking で網羅性保証（新しい値の追加時にコンパイルエラー）
const getMessage = (status: Status): string =>
  match(status)
    .with('pending', () => '待機中')
    .with('running', () => '実行中')
    .with('completed', () => '完了')
    .with('failed', () => '失敗')
    .exhaustive();
```

**使用場面**: Union型分岐、エラーハンドリング、状態遷移、複数条件の組み合わせ
**例外**: 単純なboolean判定（`if (isLoading)`）のみ if 文でよい

### 便利パターン

- `P.union('a', 'b')` — 複数値マッチ
- `P.instanceOf(Error)` — 型ガード
- `.otherwise()` — デフォルト分岐

---

## Zod（外部境界バリデーション）

**使用場面**: API境界（tRPC input/output）、ファイル読み込み、設定パース、ユーザー入力

```typescript
const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  role: z.enum(['admin', 'user', 'guest']),
});
type User = z.infer<typeof UserSchema>;
```

### Branded Types（ID混同防止）

```typescript
const UserIdSchema = z.string().uuid().brand<'UserId'>();
const PhotoIdSchema = z.string().uuid().brand<'PhotoId'>();
// getPhoto(userId) → コンパイルエラー
```

---

## 設計パターン

### 不正な状態を表現不可能にする

```typescript
// ❌ isLoading=true かつ data!=null が可能
interface State {
  isLoading: boolean;
  data: Data | null;
  error: Error | null;
}

// ✅ 不正な状態が型レベルで排除
type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: Data }
  | { status: 'error'; error: Error };
```

### Parse, Don't Validate

検証と型変換を同時に行う。検証後も `string` のままにしない。

### 早期リターンと型の絞り込み

`if (!user) return err(...)` で以降の `user` を非null保証。

---

## アンチパターン

- `any` / `unknown` の安易な使用 → Zodスキーマ経由で型を導出
- 型アサーション `as` の濫用 → スキーマの `safeParse` を使用
- オプショナルチェーンの過剰使用 → 明示的なnullチェック + 早期リターン
