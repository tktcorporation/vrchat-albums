# ログ同期アーキテクチャ

このドキュメントは、VRChat Albumsアプリケーションのログ同期処理の統一的なアーキテクチャについて説明します。

## 概要

ログ同期処理は、VRChatのログファイルから必要な情報を抽出し、アプリケーションのデータベースに保存する重要なプロセスです。従来は個別の関数呼び出しで実装されていましたが、統一的なパターンにリファクタリングされました。

## 処理フロー

ログ同期は以下の順序で実行されます：

1. **appendLoglines**: VRChatのログファイル（output_log.txt）から関連するログ行を抽出し、アプリ内のログストアファイル（logStore-YYYY-MM.txt）に保存
2. **loadLogInfo**: 保存されたログからワールド参加、プレイヤー参加/退出などの情報をパースし、データベースに保存
3. **キャッシュ無効化**: tRPCクエリキャッシュを無効化し、UIを最新データで更新

この順序が重要な理由：

- 1→2→3の順で処理しないと、新しいワールド参加ログがDBに保存されず、新しい写真が古いワールドグループに誤って割り当てられます。

## 同期モード

### FULL（全件処理）

- **使用場面**: 初回起動時、設定画面からの手動更新時
- **処理内容**: すべてのログファイルを処理し、過去のデータも含めて完全に同期
- **パラメータ**:
  - `processAll: true`
  - `excludeOldLogLoad: false`

### INCREMENTAL（差分処理）

- **使用場面**: 通常の更新時、バックグラウンド更新時
- **処理内容**: 最新のログのみを処理し、パフォーマンスを向上
- **パラメータ**:
  - `processAll: false`
  - `excludeOldLogLoad: true`

## 実装パターン

### フロントエンド（React）

```typescript
import { useLogSync, LOG_SYNC_MODE } from '@/hooks/useLogSync';

// コンポーネント内で使用
const { sync: syncLogs, isLoading } = useLogSync({
  onSuccess: () => {
    console.log('ログ同期完了');
  },
  onError: (error) => {
    console.error('ログ同期失敗:', error);
  },
});

// 全件処理（設定画面など）
await syncLogs(LOG_SYNC_MODE.FULL);

// 差分処理（リフレッシュボタンなど）
await syncLogs(LOG_SYNC_MODE.INCREMENTAL);
```

### バックエンド（Electron）

```typescript
import {
  syncLogs,
  syncLogsInBackground,
  LOG_SYNC_MODE,
} from './module/logSync/service';

// 明示的な同期
const result = await syncLogs(LOG_SYNC_MODE.FULL);

// バックグラウンド同期（常に差分処理）
const result = await syncLogsInBackground();
```

## 使用箇所

### 1. PathSettings.tsx（設定画面）

- **モード**: FULL
- **トリガー**: 「全データ再読み込み」ボタン
- **理由**: 設定変更後は完全な再同期が必要

### 2. PhotoGallery/Header.tsx（ギャラリーヘッダー）

- **モード**: INCREMENTAL
- **トリガー**: リフレッシュボタン
- **理由**: 通常の更新では最新データのみで十分

### 3. useStartUpStage.ts（起動処理）

- **モード**: 動的判定
  - 初回起動時（既存ログ0件 or DBエラー）: FULL
  - 通常起動時（既存ログあり）: INCREMENTAL
- **トリガー**: アプリ起動時
- **判定ロジック**: 既存のワールド参加ログの件数で初回起動を判定

### 4. electronUtil.ts（バックグラウンド処理）

- **モード**: INCREMENTAL（自動）
- **トリガー**: 6時間間隔のタイマー
- **理由**: バックグラウンドでは最新データのみを効率的に処理

## tRPCエンドポイント

### 統一エンドポイント

```typescript
// 新しい統一エンドポイント
trpcReact.logSync.syncLogs.useMutation();

// 使用例
const mutation = trpcReact.logSync.syncLogs.useMutation({
  onSuccess: () => {
    // 成功時の処理（キャッシュ無効化は自動実行）
  },
  onError: (error) => {
    // エラー処理
  },
});

await mutation.mutateAsync({ mode: 'FULL' });
```

### 従来のエンドポイント（非推奨）

```typescript
// 個別エンドポイント（可能な限り使用を避ける）
trpcReact.vrchatLog.appendLoglinesToFileFromLogFilePathList.useMutation();
trpcReact.logInfo.loadLogInfoIndex.useMutation();
```

## クエリ無効化

ログ同期完了後、以下のクエリが自動的に無効化されます：

```typescript
// 写真関連
utils.vrchatPhoto.getVrchatPhotoPathModelList.invalidate();

// ワールド参加ログ関連
utils.vrchatWorldJoinLog.getVRChatWorldJoinLogList.invalidate();
```

## エラーハンドリング

```typescript
const { sync } = useLogSync({
  onError: (error) => {
    // tRPCエラーは自動的にトーストで表示される
    // 必要に応じて追加の処理を実装
    console.error('ログ同期エラー:', error);
  },
});
```

## パフォーマンス考慮事項

1. **差分処理の優先**: 通常の操作では必ずINCREMENTALモードを使用
2. **全件処理の制限**: FULLモードは初回起動と明示的な再同期時のみ使用
3. **バックグラウンド処理**: 6時間間隔で自動的に差分同期を実行
4. **キャッシュ無効化**: 必要なクエリのみを無効化し、不要なリクエストを避ける

## 移行ガイド

### 従来のパターンから新しいパターンへの移行

```typescript
// ❌ 従来のパターン
const appendMutation =
  trpcReact.vrchatLog.appendLoglinesToFileFromLogFilePathList.useMutation({
    onSuccess: () => {
      loadInfoMutation.mutate({ excludeOldLogLoad: true });
    },
  });
const loadInfoMutation = trpcReact.logInfo.loadLogInfoIndex.useMutation({
  onSuccess: () => {
    invalidatePhotoGalleryQueries(utils);
  },
});

// ✅ 新しいパターン
const { sync } = useLogSync({
  onSuccess: () => {
    // キャッシュ無効化は自動実行されるため不要
  },
});
```

## 初回起動判定ロジック

### 判定基準

```typescript
// 既存のワールド参加ログ件数で判定
const { data: existingLogCount, isError: isLogCountError } =
  trpcReact.vrchatWorldJoinLog.getVRChatWorldJoinLogList.useQuery();

const isFirstLaunch = isLogCountError || (existingLogCount ?? 0) === 0;
const syncMode = isFirstLaunch ? LOG_SYNC_MODE.FULL : LOG_SYNC_MODE.INCREMENTAL;
```

### 判定結果

- **FULL（全件処理）**: DBエラー時 OR 既存ログ0件の場合
- **INCREMENTAL（差分処理）**: 既存ログが1件以上ある場合

### キャッシュ戦略

```typescript
// 初回起動判定クエリ
{
  staleTime: 0, // アプリ起動ごとに最新状態で判定
  cacheTime: 1000 * 60 * 1, // 1分後にメモリから削除
  refetchOnWindowFocus: false, // 不要な再取得を防止
  refetchOnReconnect: false,
}

// 通常のデータクエリ（写真リストなど）
{
  staleTime: 1000 * 60 * 5, // 5分間キャッシュ
  refetchOnWindowFocus: false,
}
```

この仕組みにより、真の初回起動時のみ全件処理が実行され、2回目以降の起動では効率的な差分処理が行われます。

## トラブルシューティング

### よくある問題

1. **新しい写真が古いワールドにグループされる**
   - 原因: appendLoglines → loadLogInfo の順序が守られていない
   - 解決: 統一された useLogSync フックを使用

2. **パフォーマンスが悪い**
   - 原因: 不要な全件処理が実行されている
   - 解決: 適切な同期モードを選択、初回起動判定ロジックの確認

3. **UIが更新されない**
   - 原因: クエリキャッシュが無効化されていない
   - 解決: useLogSync フックを使用（自動的に無効化される）

4. **毎回全件処理される**
   - 原因: 初回起動判定が正しく動作していない
   - 解決: DBの既存ログデータを確認、クエリエラーの確認
