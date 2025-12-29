# Linter化候補: ログ同期順序チェック

## 現状の規約
```xml
<log-synchronization priority="critical">
  <execution-order strict="true">appendLoglines → loadLogInfo → cache invalidation</execution-order>
  <usage>
    <allowed>useLogSync hook (frontend) / syncLogs() service (backend)</allowed>
    <forbidden>Call append/load functions individually</forbidden>
  </usage>
</log-synchronization>
```

## なぜLinter化すべきか
- 違反すると写真が間違ったワールドに分類される（データ整合性問題）
- 手動レビューでは見落としやすい

## 実装の難しさ
- **静的解析では困難**: 実行順序の解析はコールグラフ + 実行フロー解析が必要
- 関数が別ファイルにある場合、追跡が複雑

## 代替案
### 1. 禁止関数の直接呼び出し検出 (GritQL)
```grit
language js

// appendLoglines, loadLogInfo の直接呼び出しを検出
// syncLogs() 経由のみ許可
or {
  `appendLoglines($args)`,
  `loadLogInfo($args)`
} where {
  // syncLogs内部からの呼び出しは除外
  $filename <: not r"logSync/service\.ts$"
}
```

### 2. ランタイムチェック (推奨)
```typescript
// 開発時のみ有効なアサーション
if (process.env.NODE_ENV === 'development') {
  assertSyncOrder(); // 順序違反時にエラー
}
```

### 3. アーキテクチャ制約
- appendLoglines, loadLogInfo を非公開にする
- syncLogs() のみを公開APIとして提供

## 優先度
低（静的解析が困難）

## 備考
- 代替案2または3で設計レベルで制約する方が現実的
- linterよりも設計パターンで解決すべき問題
