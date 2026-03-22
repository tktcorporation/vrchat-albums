# 写真グルーピングロジック仕様書

## 概要

VRChat写真を撮影時のワールドセッション単位でグループ化する機能の詳細仕様。

## データソース

### 1. ログタイプ

#### ワールド参加ログ (World Join Log)

- **パターン**: `Joining wrld_`
- **意味**: ユーザーがワールドに参加した
- **グループ開始**: このログでセッショングループが開始される

#### プレイヤー参加ログ (Player Join Log)

- **パターン**: `[Behaviour] OnPlayerJoined`
- **意味**: 他のプレイヤーが同じワールドに参加した
- **グループ継続**: 現在のセッショングループに属する

#### プレイヤー退出ログ (Player Leave Log)

- **パターン**: `OnPlayerLeft` (※`OnPlayerLeftRoom`は除外)
- **意味**: プレイヤーがワールドから退出した
- **グループ継続**: 現在のセッショングループに属する

#### ワールド退出・アプリ終了

- **現状**: 明示的な処理なし
- **問題点**: セッションの終了タイミングが不明確

### 2. 写真ログ（旧アプリ互換）

#### ファイル名パターン

```
VRChat_YYYY-MM-DD_HH-mm-ss.SSS_wrld_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.ext
```

#### 処理フロー

1. `photoLogImporter.ts`: ファイル名からワールドID・日時を抽出
2. `vrchatWorldJoinLogFromPhoto`: 写真ログ専用テーブルに保存
3. `mergeVRChatWorldJoinLogs`: 通常ログと統合（重複時は通常ログ優先）

## 現在のグルーピングロジック

### アルゴリズム（`useGroupPhotos.ts`）

1. **前処理**
   - 写真を新しい順にソート
   - ワールド参加ログを新しい順にソート

2. **グループ割り当て**

   ```typescript
   for (const photo of sortedPhotos) {
     // 1. 写真撮影時刻以前で最も近いログを探す
     let bestGroupIndex = findClosestLogIndexBefore(sortedLogs, photoTime);

     // 2. 見つからない場合は、時間的に最も近いログに割り当て
     if (bestGroupIndex === -1) {
       bestGroupIndex = findClosestLogIndexAbsolute(sortedLogs, photoTime);
     }

     // 3. 該当グループに写真を追加
     groupMap.get(bestGroupIndex)?.photos.push(photo);
   }
   ```

3. **後処理**
   - 各グループ内の写真を新しい順にソート

## 問題点と課題

### 1. セッション終了の判定不可

- **現状**: ワールド退出・アプリ終了ログが処理されていない
- **影響**: 異なるセッションの写真が同じグループに混在する可能性

### 2. プレイヤー情報の未活用

- **現状**: プレイヤー参加・退出ログは抽出されるが、グルーピングには使用されない
- **影響**: 同じワールドでも異なるプレイヤー構成の写真が混在

### 3. タイムライン的な処理の欠如

- **現状**: 単純に「最も近いワールド参加ログ」に割り当て
- **理想**: ワールド参加 → 滞在中 → 退出のライフサイクルを考慮

### 4. 写真ログの優先順位

- **現状**: `mergeVRChatWorldJoinLogs`で重複時は通常ログ優先
- **確認必要**: この優先順位が正しく機能しているか

## 実装された改善案

### 1. ✅ セッションモデルの導入

```typescript
interface Session {
  worldId: string;
  worldName: string;
  worldInstanceId: string;
  joinTime: Date;
  leaveTime?: Date; // 退出時刻（退出ログまたは推測による）
  photos: Photo[];
}
```

### 2. ✅ ワールド退出ログの処理追加

**実装ファイル**: `electron/module/vrchatLog/parsers/worldLeaveParser.ts`

1. **明示的な退出パターン**
   - `OnApplicationPause`, `OnApplicationQuit`
   - `Lost connection`, `Disconnected`
   - `Left Room`, `Leaving room`

2. **推測による退出検出**
   - 次のワールド参加ログの直前で退出と判定
   - ログファイル終了時にアプリ終了として判定

### 3. ✅ 改善されたグルーピングアルゴリズム

**実装ファイル**: `src/v2/components/PhotoGallery/useGroupPhotos.v2.ts`

```typescript
function assignPhotoToSession(
  photo: Photo,
  sessions: Session[],
): Session | null {
  // 1. セッション期間内の写真を正確に検出
  const activeSession = sessions.find((session) => {
    const photoTime = photo.takenAt.getTime();
    const joinTime = session.joinTime.getTime();
    const leaveTime = session.leaveTime?.getTime();

    if (leaveTime) {
      return photoTime >= joinTime && photoTime < leaveTime;
    } else {
      return photoTime >= joinTime; // 最新セッション
    }
  });

  // 2. フォールバック: 最も近いセッションを探す
  if (!activeSession) {
    return findClosestSession(photo, sessions);
  }

  return activeSession;
}
```

### 4. ✅ タイムゾーン処理の検証

**実装ファイル**: `electron/module/vrchatLog/parsers/timezone.test.ts`

- VRChatログと写真ファイル名の日時はローカルタイムとして統一処理
- `Date.getTime()`による数値比較でタイムゾーン問題を回避
- 夏時間や境界ケースも考慮したテスト実装

### 5. ✅ 包括的なテスト戦略

1. **エッジケース** (`useGroupPhotos.v2.test.ts`)
   - セッション境界外の写真処理
   - 同じワールドの複数セッション
   - 最新セッション（終了時刻なし）

2. **データ整合性** (`mergeLogic.test.ts`)
   - 写真ログと通常ログの重複処理
   - 優先順位の正確な適用

3. **パフォーマンス**
   - 1000枚の写真、100個のセッションでの動作確認
   - 大量データでのソート処理検証

## 今後の発展可能性

### 1. プレイヤー情報の活用

```typescript
interface EnhancedSession extends Session {
  players: {
    userId: string;
    userName: string;
    joinTime: Date;
    leaveTime?: Date;
  }[];
}
```

### 2. より高度な退出検出

- VRChatアプリのログレベル向上による明示的な退出ログ
- ネットワーク接続状態の監視
- ユーザー行動パターンの学習

### 3. UIの改善

- セッション情報の可視化
- デバッグ情報の表示
- グルーピング精度の指標表示
