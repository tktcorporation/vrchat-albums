# ログ同期アーキテクチャ

VRChat ログファイルと写真の関連付けを正しく行うための同期処理規約。

---

## 重要度: CRITICAL

**違反すると写真が間違ったワールドに分類されます**

---

## 実行順序（厳守）

```
appendLoglines → loadLogInfo → cache invalidation
```

この順序を守らないとデータ整合性が崩れる。

---

## 使用方法

### フロントエンド

```typescript
// ✅ 許可: useLogSync フックを使用
const { syncLogs } = useLogSync();
await syncLogs();

// ❌ 禁止: 個別関数を直接呼び出し
await appendLoglines();
await loadLogInfo();
```

### バックエンド

```typescript
// ✅ 許可: syncLogs() サービスを使用
await syncLogs();

// ❌ 禁止: 個別関数を直接呼び出し
await appendLoglines();
await loadLogInfo();
```

---

## 同期モード

| モード | 用途 | 処理内容 |
|--------|------|----------|
| FULL | 初回起動、設定更新時 | 完全な再処理 |
| INCREMENTAL | 通常更新、バックグラウンド | 差分のみ処理 |

---

## アーキテクチャ

```
VRChat Log Files
       ↓
  appendLoglines()  ← ログ行を追加
       ↓
   loadLogInfo()    ← ログ情報をDBにロード
       ↓
 cache invalidation ← React Queryキャッシュを無効化
       ↓
  Photos Display    ← 写真が正しいワールドに表示
```

---

## なぜこの順序か

1. **appendLoglines**: 新しいログ行をパースして追加
2. **loadLogInfo**: パースしたログからワールド情報を抽出
3. **cache invalidation**: フロントエンドのキャッシュを更新

順序が崩れると、古いキャッシュが使われたり、不完全なデータで表示されたりする。

---

## 関連ドキュメント

- `docs/log-sync-architecture.md` - 詳細なアーキテクチャ説明
- `electron/module/logSync/` - 同期サービス実装
- `src/v2/hooks/useLogSync.ts` - フロントエンドフック
