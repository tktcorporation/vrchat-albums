# コードの意図を記録するルール

## 原則: WHY を残す

コードには **なぜそれが存在するのか（WHY）** を記録する。WHAT（何をしているか）はコード自体が語る。WHY がないと、後から見た人が「これはまだ必要か？削除していいか？」を判断できない。

## 具体的なルール

### 関数・モジュールレベル

- 公開関数 (`export`) には JSDoc で **目的・背景・使用箇所** を書く
- 「この関数はどういう課題を解決するために作られたか」が分かるようにする
- 削除判断の材料になる情報を含める（例: 「〜の代替として導入」「〜が不要になれば削除可能」）

```typescript
/**
 * スヌーズアラームを9分後にスケジュールする。
 *
 * 背景: TODO完了まで繰り返しスヌーズを鳴らすことで、ユーザーが二度寝するのを防ぐ。
 * iOSの標準アラームと同じ9分間隔。AlarmKit の scheduleAlarm を使用。
 *
 * 呼び出し元: app/wakeup.tsx (アラーム解除時)
 * 対になる関数: cancelSnooze() (TODO全完了時に取消)
 */
export async function scheduleSnooze(): Promise<string | null> {
```

### 非自明なロジック

- 「なぜこの方法を選んだか」「なぜこの順序か」をインラインコメントで書く
- ワークアラウンドには理由と、いつ不要になるかを書く

```typescript
// setTimeout(0) で Zustand の state 更新を待つ。
// toggleTodo() は同期的に set() するが、コールバック内で getState() すると
// 更新前の値が返る場合があるため。
setTimeout(() => { ... }, 0);
```

### 型・インターフェース

- データモデルには「何を表現しているか」「ライフサイクル」を書く

```typescript
/**
 * アクティブな朝ルーティンのセッション。
 * アラーム解除時に作成され、TODO全完了 or 次のアラームで破棄される。
 * AsyncStorage に永続化（アプリ再起動後も継続）。
 */
export interface MorningSession { ... }
```

### 定数

- マジックナンバーには由来を書く

```typescript
/** iOSの標準アラームと同じ9分間隔 */
export const SNOOZE_DURATION_SECONDS = 540;
```

### 一見して意図が分からない初期化・デフォルト値・配置

- 「なぜここでこの値を設定しているのか」が文脈なしでは分からないコードには、理由を書く
- 特に: 防御的デフォルト値、上流で保証するための初期化、定数を特定ファイルに集約した理由

```python
# ✗ BAD: 読み手は「なぜ False をわざわざ設定？」と思う
data['email_verified'] = False

# ✓ GOOD: 下流が暗黙の None に依存しないよう、上流で契約を保証
# /emails API 失敗時や primary email が見つからないパスでも
# email_verified が必ず存在することを保証する。
data['email_verified'] = False
```

```python
# ✗ BAD: なぜこの定数がここにある？
NO_SNS_IDENTIFIER_PROVIDERS = frozenset({...})

# ✓ GOOD: 関連する定数群をまとめた理由と参照先を明記
# --- プロバイダー特性による分類 ---
# 新しいプロバイダー追加時はここを確認し、該当するセットに追加すること。
# 参照: modules.user.service.activation.activate_user_and_create_person
NO_SNS_IDENTIFIER_PROVIDERS = frozenset({...})
```

## 書かなくていいもの

- 自明なゲッター/セッター (`getName` に「名前を取得する」は不要)
- フレームワークの定型パターン (useEffect, useState の基本用法)
- 型名やパラメータ名から明らかなこと

## 関連プラクティス

- **設計ドキュメント** (`docs/plans/`): 大きな機能追加の背景・設計判断・トレードオフを記録する。コード内コメントはこのドキュメントへの参照を含めてよい
- **コミットメッセージ**: WHY を本文に含める。`feat: add X` だけでなく、なぜ X が必要かを書く
- **削除の判断基準**: コメントに「〜が不要になれば削除可能」と書いてあれば、その条件を確認して安全に削除できる
