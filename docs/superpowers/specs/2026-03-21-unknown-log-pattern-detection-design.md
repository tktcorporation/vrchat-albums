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
| `electron/module/vrchatLog/service.ts` | ハードコードを `FILTER_PATTERNS` 定数に置換 |
| `electron/module/vrchatLog/parsers/index.ts` | World Join の LOG_FORMAT_MISMATCH を Sentry 送信 |
| `electron/module/vrchatLog/fileHandlers/logFileReader.ts` | 未知パターン検出（ケースB） |

### 1. logPatterns.ts

`BEHAVIOUR_TAG` と `WORLD_NAME` 定数を追加。未知パターン判定に使う既知パターンリスト `KNOWN_BEHAVIOUR_PATTERNS` を定義。`FILTER_PATTERNS` は具体的なパターンのままとし、パフォーマンスを維持。

### 2. service.ts

`includesList` のハードコードを `FILTER_PATTERNS` 定数の参照に置換。パターン自体は変更なし。

### 3. parsers/index.ts（ケースA）

World Join の `LOG_FORMAT_MISMATCH` 除外ガードを削除。`match` 分岐に `LOG_FORMAT_MISMATCH` ケースを追加し、Sentry送信する。

### 4. logFileReader.ts（ケースB）

ファイル読み込みの行イベント内で未知パターンを検出。`FILTER_PATTERNS` にマッチしなくても `[Behaviour]` を含む行は `KNOWN_BEHAVIOUR_PATTERNS` と照合し、該当しなければ Sentry に送信する。パーサーに不要な行を渡さないため、`FILTER_PATTERNS` を広げるよりもパフォーマンスが良い。タイムスタンプを除外した `[Behaviour]` 以降の部分で重複判定し、同一パターンはファイル内で1回のみ送信。

### Sentryでの見え方

| ケース | メッセージ | グルーピング |
|-------|-----------|------------|
| A | `World join parse error: Log format mismatch` | 既存のparse errorイシューと同系列 |
| B | `Unrecognized VRChat log pattern detected` | 独立したイシュー |

どちらも `details.logLine` に実際のログ行が含まれる。

## トレードオフ

- **メモリ**: `FILTER_PATTERNS` は変更なし。未知パターン検出はファイルリーダーの行イベント内で完結するため、メモリへの影響はない。
- **Sentryクォータ**: タイムスタンプを除外した重複排除により同一パターンはファイル内で1回のみ送信。異なるファイル間の重複は Sentry のレート制限に依存する。
