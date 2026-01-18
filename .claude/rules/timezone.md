# タイムゾーン処理ガイドライン

VRChat ログと写真の日時データを正しく処理するための規約。

---

## 基本原則

**すべての日時データをローカルタイムとして統一処理する**

---

## 処理フロー

| 処理 | 方法 |
|------|------|
| ログパース | `parseLogDateTime()` でローカルタイムとして解釈 |
| フロントエンド | `new Date('YYYY-MM-DDTHH:mm:ss')` でローカルタイム処理 |
| DB保存 | Sequelize が Date オブジェクトを自動的に UTC で保存 |
| UTC変換 | JavaScript Date オブジェクトがローカルタイム→UTC変換を自動実行 |
| 写真タイムスタンプ | ファイル名の日時もローカルタイムとして処理 |

---

## 重要なルール

1. **日時処理では常にローカルタイムベースで実装**
2. **UTC変換は Sequelize/JavaScript に委ねる**
3. **明示的な UTC 変換は行わない**

---

## コード例

### ログの日時パース

```typescript
// ✅ Good: ローカルタイムとしてパース
const logDate = parseLogDateTime('2024.01.15 12:34:56');

// ❌ Bad: UTC として扱う
const logDate = new Date('2024-01-15T12:34:56Z');
```

### フロントエンドでの日時表示

```typescript
// ✅ Good: ローカルタイムとして解釈される
const date = new Date('2024-01-15T12:34:56');

// ❌ Bad: UTC として解釈される
const date = new Date('2024-01-15T12:34:56Z');
```

---

## テストパターン

参考: `electron/module/vrchatLog/parsers/timezone.test.ts`

```typescript
describe('timezone handling', () => {
  it('should parse as local time', () => {
    const result = parseLogDateTime('2024.01.15 12:34:56');
    expect(result.getHours()).toBe(12); // ローカルタイムの12時
  });
});
```

---

## 関連ドキュメント

- `electron/module/vrchatLog/parsers/` - ログパーサー実装
- `electron/module/vrchatPhoto/` - 写真タイムスタンプ処理
