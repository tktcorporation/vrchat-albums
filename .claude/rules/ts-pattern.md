# ts-pattern 使用規約

ts-pattern は型安全なパターンマッチングを提供し、exhaustive checking による堅牢性を確保します。

---

## 基本原則

**すべての条件分岐で `match()` を使用する**

```typescript
import { match, P } from 'ts-pattern';

// ✅ Good: ts-pattern による型安全なマッチング
return match(error)
  .with(P.instanceOf(Error), (err) => handleError(err))
  .otherwise((err) => { throw err; });

// ❌ Bad: if文による条件分岐
if (error instanceof Error) return handleError(error);
```

---

## 優先的に使用すべき場面

| 場面 | 説明 |
|------|------|
| エラーハンドリング | エラー種別による分岐処理 |
| Enum/リテラル比較 | 文字列リテラル型やEnumの分岐 |
| 型ガード | `instanceof` や型チェック |
| ネストしたif-else | 複数条件の組み合わせ |

---

## 例外（if文でよい場合）

- 単純なboolean判定（`if (isLoading)`）
- 複雑なビジネスロジック条件
- テストのアサーション

---

## アンチパターン（絶対禁止）

### 1. match() を if文に書き換える

```typescript
// ❌ 禁止: シンプル化ではなく堅牢性の低下
// ts-pattern を削除して if文に変換

// ✅ 必須: match() を維持
match(status)
  .with('pending', () => ...)
  .with('success', () => ...)
  .exhaustive();
```

**理由**: exhaustive checking が失われ、新しい状態が追加された時にコンパイルエラーで検出できなくなる。

### 2. 「可読性向上」を理由に ts-pattern を削除

**理由**: ts-pattern 自体が可読性と型安全性を両立させるツール。削除は堅牢性の低下。

---

## 推奨パターン

### exhaustive() による網羅性チェック

```typescript
type Status = 'pending' | 'running' | 'completed' | 'failed';

const getMessage = (status: Status): string =>
  match(status)
    .with('pending', () => '待機中')
    .with('running', () => '実行中')
    .with('completed', () => '完了')
    .with('failed', () => '失敗')
    .exhaustive(); // 新しい status が追加されたらコンパイルエラー
```

### P.union() による複数値マッチ

```typescript
match(stage)
  .with(P.union('success', 'skipped'), () => clearError())
  .otherwise(() => {});
```

### P.instanceOf() による型ガード

```typescript
match(error)
  .with(P.instanceOf(ValidationError), (e) => handleValidation(e))
  .with(P.instanceOf(NetworkError), (e) => handleNetwork(e))
  .otherwise((e) => { throw e; });
```

---

## 関連ドキュメント

- [ts-pattern 公式ドキュメント](https://github.com/gvergnaud/ts-pattern)
- `.claude/rules/error-handling.md` - エラーハンドリングでの使用例
