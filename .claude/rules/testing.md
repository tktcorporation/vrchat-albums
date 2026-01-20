# テストガイドライン

Vitest を使用したユニットテストと Playwright を使用した E2E テストのガイドライン。

---

## データベーステストパターン

```typescript
describe('service with database', () => {
  beforeAll(async () => {
    client.__initTestRDBClient();
  }, 10000);

  beforeEach(async () => {
    await client.__forceSyncRDBClient();
  });

  afterAll(async () => {
    await client.__cleanupTestRDBClient();
  });

  it('test case', async () => {
    // 既存のサービス関数でテストデータを作成
    // 日付は datefns.parseISO を使用
  });
});
```

**参考**: `electron/module/logInfo/service.spec.ts`

---

## テストファイルの分離

| ファイル名 | 用途 |
|-----------|------|
| `*.test.ts` | ユニットテスト（モック使用） |
| `*.integration.test.ts` | 統合テスト（実DB使用） |

**理由**: 統合テストを分離することでデータベース初期化の競合を防ぐ。

**例**: `logInfoController.test.ts`（モック）vs `logInfoController.integration.test.ts`（実DB）

---

## Vitest モックの注意点

### Electron アプリのモック

```typescript
// vi.mock('electron') は他のモックより先に記述
vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
}));

vi.mock('./otherModule');
```

### 複雑なファイルシステムモック

複雑なモックが失敗する場合は `describe.skip()` を使用。

### 動的インポートの制限

動的インポートは Vitest のモックタイミング問題を常に解決するわけではない。

---

## モジュールパスの確認（重要）

```typescript
// electron/module/vrchatLog/ から electron/lib/ へ
// 正しい: ../../lib/
// 間違い: ../../../lib/
```

**症状**: `TypeError: The "path" argument must be of type string. Received undefined`

**原因**: モックされた関数が undefined を返す（パスが間違っているため）

**解決策**: import パスと vi.mock() パスの両方を修正

---

## E2E テスト（Playwright）

### 基本構造

```typescript
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';

test.describe('Feature', () => {
  test('should work', async () => {
    const app = await launchApp();
    const window = await app.firstWindow();

    // テスト実行

    await closeApp(app);
  });
});
```

### Electron インポートの注意

トップレベルで Electron をインポートすると Playwright テストがタイムアウトする。
詳細は `.claude/rules/electron-import.md` を参照。
