# Electron モジュールインポート規約

Playwright テストとの互換性を確保するための Electron インポート規約。

---

## 禁止事項

**トップレベルで Electron の app, BrowserWindow 等をインポートしてはならない**

```typescript
// ❌ NEVER: Playwright テストでクラッシュ
import { app } from 'electron';
const logPath = app.getPath('logs');
```

---

## 推奨パターン

### 遅延評価（require）

```typescript
// ✅ OK: 遅延評価
const getLogPath = () => {
  try {
    const { app } = require('electron');
    return app.getPath('logs');
  } catch {
    return '/tmp/test-logs';
  }
};
```

### 動的インポート

```typescript
// ✅ OK: 動的インポート
const getLogPath = async () => {
  try {
    const { app } = await import('electron');
    return app.getPath('logs');
  } catch {
    return '/tmp/test-logs';
  }
};
```

---

## 影響範囲

### 共通モジュールでの注意

`logger.ts` など共通モジュールでのトップレベルインポートは**全体に影響**する。

```typescript
// ❌ logger.ts でこれをやると全テストが影響を受ける
import { app } from 'electron';
```

---

## 症状と原因

| 症状 | 原因 |
|------|------|
| Playwright テストで `electronApplication.firstWindow: Timeout` エラー | トップレベル Electron インポート |
| テストが無限に待機 | Electron 初期化がブロック |

---

## デバッグ方法

1. エラーが発生したらインポートチェーンを確認
2. `import { app } from 'electron'` を検索
3. 遅延評価パターンに置き換え

---

## 関連ドキュメント

- `docs/troubleshooting-migration-playwright-timeout.md` - トラブルシューティング詳細
- `.claude/rules/testing.md` - テストガイドライン
