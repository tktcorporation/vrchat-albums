# ValueObject パターン

型安全なカプセル化を実現するための ValueObject 実装規約。

---

## 基本原則

1. **型のみをエクスポート**（クラス自体はエクスポートしない）
2. **Zod スキーマ経由でインスタンス生成**（直接 new 禁止）
3. **バリデーション関数を提供**

---

## 実装パターン

### クラス定義

```typescript
class MyValueObject extends BaseValueObject<'MyValueObject', string> {}

// ✅ 型のみエクスポート
export type { MyValueObject };

// ❌ クラスエクスポート禁止
// export { MyValueObject };
```

### Zod スキーマ

```typescript
export const MyValueObjectSchema = z.string()
  .min(1)
  .transform((val) => new MyValueObject(val));
```

### バリデーション関数

```typescript
export const isValidMyValueObject = (value: string): boolean => {
  return MyValueObjectSchema.safeParse(value).success;
};
```

---

## 使用例

```typescript
// ✅ Good: スキーマ経由でインスタンス生成
const obj = MyValueObjectSchema.parse(value);

// ❌ Bad: 直接 new
const obj = new MyValueObject(value);
```

---

## Lint による自動検証

```bash
pnpm lint:valueobjects
```

このコマンドで ValueObject の正しい実装パターンを自動検証。

---

## なぜこのパターンか

| 目的 | 方法 |
|------|------|
| 不正なインスタンス生成を防止 | クラスを直接エクスポートしない |
| バリデーションを強制 | Zod スキーマ経由のみ許可 |
| 型安全性の確保 | Branded Types による意味的区別 |

---

## 関連ドキュメント

- `.claude/rules/robustness.md` - 堅牢性設計の詳細
- `electron/lib/valueObject/` - BaseValueObject 実装
