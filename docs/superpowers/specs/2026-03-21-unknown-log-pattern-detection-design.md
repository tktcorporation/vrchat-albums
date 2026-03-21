# 未知ログパターン検出によるVRChat仕様変更の早期発見

## 背景

VRChatのログ形式が変更された場合、アプリが想定外のパターンで落ちるか、データが静かに欠損する。現状は一部のパースエラーのみSentryに送信されており、検出に穴がある。

## 課題

### ケースA: 既知パターンのフォーマット変更

キーワード（`Joining wrld_` 等）にはマッチするが正規表現でパースできないケース。

- **Player Join/Leave**: `LOG_FORMAT_MISMATCH` を含む全エラーがSentry送信される ✓
- **World Join**: `LOG_FORMAT_MISMATCH` が静かにスキップされる ✗

### ケースB: 新しい種類のログ行の追加

`[Behaviour]` タグ付きで、既知のどのパターンにも該当しない行。現状は `service.ts` の `includesList` フィルタにより、パーサーに到達すらしない。

## 設計

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `electron/module/vrchatLog/constants/logPatterns.ts` | 既知パターン定数の追加 |
| `electron/module/vrchatLog/service.ts` | includesListの拡大 |
| `electron/module/vrchatLog/parsers/index.ts` | LOG_FORMAT_MISMATCH修正 + 未知パターン検出 |

### 1. logPatterns.ts

`BEHAVIOUR_TAG` と `WORLD_NAME` 定数を追加。未知パターン判定に使う既知パターンリスト `KNOWN_BEHAVIOUR_PATTERNS` を定義。

### 2. service.ts

`includesList` を `['[Behaviour]', 'VRC Analytics Initialized', 'VRCApplication: HandleApplicationQuit']` に変更。`[Behaviour]` が既存の3つの個別パターンを包含するため、既存動作は維持される。

### 3. parsers/index.ts

**修正A**: World Join の `LOG_FORMAT_MISMATCH` 除外ガードを削除。`match` 分岐に `LOG_FORMAT_MISMATCH` ケースを追加し、Sentry送信する。

**修正B**: ループ末尾で `[Behaviour]` を含み既知パターンにマッチしない行を検出し、`logger.error` で Sentry 送信。

### Sentryでの見え方

| ケース | メッセージ | グルーピング |
|-------|-----------|------------|
| A | `World join parse error: Log format mismatch` | 既存のparse errorイシューと同系列 |
| B | `Unrecognized VRChat log pattern detected` | 独立したイシュー |

どちらも `details.logLine` に実際のログ行が含まれる。

## トレードオフ

- **メモリ**: `[Behaviour]` フィルタ拡大により、パーサーに届く行数が増える。ただし行単位フィルタのため大きな影響はない。
- **Sentryクォータ**: 全件送信のため、未知パターンが大量にある場合はSentryのレート制限に依存する。
