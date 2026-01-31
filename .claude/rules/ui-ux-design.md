# UI/UX デザインガイドライン

AI がこのプロジェクトの UI を設計・実装する際の必須ルール。
**コードを書く前にこのドキュメントを必ず参照すること。**

---

## 設計哲学: 引き算のデザイン

**「何を追加するか」ではなく「何を追加しないか」を考える。**

このアプリは VRChat の写真を閲覧・整理するツールであり、写真がコンテンツの主役。
UI はコンテンツを邪魔せず、ユーザーの操作を最短経路で実現することが最優先。

| 原則 | 説明 |
|------|------|
| コンテンツファースト | 写真の視認性を最大化。UIクロームは最小限 |
| 一貫性 > 独創性 | 既存パターンの踏襲が最善。新規パターンは最終手段 |
| 機能 > 装飾 | すべてのUI要素に「なぜこれが必要か」の理由が必要 |
| 静寂 > 賑やかさ | デフォルトは静かに。アニメーションや色はアクションへの反応時のみ |

---

## 必須: 実装前プロセス

**UI変更を行う前に、以下の手順を必ず実行する。**

### Step 1: 既存パターンの調査

```
1. 類似の既存コンポーネントを検索（src/components/ui/, src/v2/components/）
2. デザイントークンを確認（src/v2/constants/ui.ts）
3. 既存コンポーネントで要件を満たせるか検討
```

**既存コンポーネントで 80% 以上の要件を満たせるなら、新規コンポーネントは作らない。**

### Step 2: 影響範囲の確認

```
1. 変更するUIが他の画面にも影響するか
2. ライトモード・ダークモード両方で問題ないか
3. ウィンドウサイズの変化に対応できるか（Electron デスクトップアプリ）
```

### Step 3: 最小構成での設計

```
1. 必要最低限の要素だけで設計を始める
2. 「これを削除しても機能するか？」を各要素に問う
3. 削除しても機能する要素は削除する
```

---

## デザイントークン参照（必須）

### カラー

**直接的な色指定（`bg-blue-500`, `text-gray-700` 等）は禁止。必ずセマンティックトークンを使用する。**

| 用途 | 使用するトークン | 参照 |
|------|----------------|------|
| テキスト色 | `TEXT_COLOR.*` | `text-foreground`, `text-muted-foreground` 等 |
| 背景色 | `SURFACE_COLOR.*` | `bg-background`, `bg-card`, `bg-muted` 等 |
| ステータス | `STATUS_COLOR.*` | `bg-success/10 text-success` 等 |
| ボーダー | `BORDER.*` | `border border-border`, `border border-border/30` 等 |

**参照ファイル**: `src/v2/constants/ui.ts`

### タイポグラフィ

**フォントサイズ・ウェイトの直接指定は禁止。`TYPOGRAPHY.*` トークンを使用する。**

| 用途 | トークン | 結果 |
|------|---------|------|
| ページタイトル | `TYPOGRAPHY.display.page` | 30px, bold |
| セクションタイトル | `TYPOGRAPHY.display.section` | 24px, bold |
| カードタイトル | `TYPOGRAPHY.heading.primary` | 20px, semibold |
| 設定の見出し | `TYPOGRAPHY.heading.secondary` | 18px, semibold |
| 小見出し | `TYPOGRAPHY.heading.tertiary` | 16px, medium |
| 本文 | `TYPOGRAPHY.body.primary` | 14px |
| 補助テキスト | `TYPOGRAPHY.caption.default` | 12px, muted |

### スペーシング

**8px グリッドベース。`SPACING.*` トークンを使用する。**

| 用途 | トークン | 値 |
|------|---------|-----|
| 密接な要素間 | `SPACING.stack.tight` | 8px |
| フォーム要素間 | `SPACING.stack.default` | 16px |
| セクション内 | `SPACING.stack.relaxed` | 24px |
| セクション間 | `SPACING.stack.loose` | 32px |

### アイコン

**lucide-react のみ使用。`ICON_SIZE.*` トークンでサイズ指定。**

| 用途 | サイズ | クラス |
|------|-------|--------|
| バッジ | `ICON_SIZE.xs` | `h-3 w-3` |
| デフォルト | `ICON_SIZE.sm` | `h-4 w-4` |
| ボタン内 | `ICON_SIZE.md` | `h-5 w-5` |
| ローディング | `ICON_SIZE.lg` | `h-8 w-8` |

---

## 禁止事項（アンチパターン）

### 1. 過剰な装飾の追加

```typescript
// ❌ 禁止: 不要なグラデーション、シャドウ、アニメーションの追加
<div className="bg-gradient-to-r from-purple-500 to-pink-500 shadow-2xl
  animate-pulse rounded-3xl border-4 border-gold">
  <h1 className="text-4xl font-extrabold bg-clip-text text-transparent
    bg-gradient-to-r from-blue-600 to-purple-600">
    設定
  </h1>
</div>

// ✅ 正しい: 既存パターンに従ったシンプルな実装
<div className={SPACING.padding.md}>
  <h1 className={TYPOGRAPHY.display.section}>設定</h1>
</div>
```

**判断基準**: 「この装飾を外してもUIの目的は達成されるか？」→ Yes なら外す。

### 2. 既存コンポーネントの再発明

```typescript
// ❌ 禁止: 既存のButtonコンポーネントがあるのに独自ボタンを作る
<button className="px-4 py-2 bg-orange-500 text-white rounded-lg
  hover:bg-orange-600 transition-colors">
  保存
</button>

// ✅ 正しい: 既存コンポーネントを使用
import { Button } from '@/components/ui/button';
<Button variant="default">保存</Button>
```

### 3. 色の直接指定

```typescript
// ❌ 禁止: Tailwindカラーの直接使用
<p className="text-gray-500 dark:text-gray-400">説明テキスト</p>
<div className="bg-blue-50 dark:bg-blue-900/20">

// ✅ 正しい: セマンティックトークンの使用
<p className={TEXT_COLOR.secondary}>説明テキスト</p>
<div className={STATUS_COLOR.info.bg}>
```

### 4. 意味のないアイコン乱用

```typescript
// ❌ 禁止: すべてのラベルにアイコンを付ける
<label>
  <User className="h-4 w-4" /> ユーザー名
</label>
<label>
  <Mail className="h-4 w-4" /> メールアドレス
</label>
<label>
  <Lock className="h-4 w-4" /> パスワード
</label>
<label>
  <Calendar className="h-4 w-4" /> 登録日
</label>

// ✅ 正しい: アイコンはナビゲーションの識別やアクションボタンに限定
<label>ユーザー名</label>
<label>メールアドレス</label>
<Button variant="ghost" size="icon">
  <Settings className={ICON_SIZE.sm.class} />
</Button>
```

**アイコンを使用してよい場面**:
- ナビゲーション要素（テキストなしで意味が通る場合）
- アクションボタン（閉じる、リフレッシュ、設定等）
- ステータス表示（成功、エラー等のインジケーター）

**アイコンを使用しない場面**:
- フォームラベルの装飾
- テキストが十分に説明している箇所
- リスト項目の先頭マーカー（テキストで十分な場合）

### 5. 過剰なアニメーション

```typescript
// ❌ 禁止: 表示時のアニメーションを何でも付ける
<div className="animate-fade-in animate-slide-up animate-bounce
  transition-all duration-500 hover:scale-110 hover:rotate-1">

// ✅ 正しい: 目的のあるアニメーションのみ
// ホバーフィードバック（微細なスケール変化）
<Button className="hover:scale-105 transition-all duration-200">

// ローディング状態の通知
<RefreshCw className={isLoading ? 'animate-spin' : ''} />
```

**アニメーション許可基準**:
| 用途 | 許可 | 例 |
|------|------|-----|
| ユーザー操作のフィードバック | ○ | ホバー時の微細な変化 (`hover:scale-105`) |
| 状態変化の通知 | ○ | ローディングスピナー |
| 要素の出現/消失 | △ | ダイアログのみ（Radix UI の標準アニメーション使用） |
| 常時アニメーション | ✕ | `animate-pulse`, `animate-bounce` 等の装飾 |
| ページ遷移 | ✕ | このアプリはSPAではなくElectronアプリ |

### 6. 不要な視覚階層の追加

```typescript
// ❌ 禁止: カードの中にカードを入れるなど、不要な入れ子構造
<div className="glass-card p-6">
  <div className="glass-card p-4">
    <div className="bg-muted rounded-lg p-3">
      <p>コンテンツ</p>
    </div>
  </div>
</div>

// ✅ 正しい: フラットな構造
<div className="glass-card p-6">
  <p>コンテンツ</p>
</div>
```

### 7. 「AIっぽい」デザインパターン

以下は AI が生成しがちで、このプロジェクトでは禁止するパターン:

| パターン | 問題 | 代替 |
|---------|------|------|
| グラデーションテキスト | 読みにくく、ブランドと無関係 | `text-foreground` |
| カード角の大きな丸み (`rounded-3xl`) | 既存UIと不整合 | `rounded-md`（`--radius` ベース） |
| 多色アイコン・絵文字 | 視覚的ノイズ | lucide-react 単色アイコン |
| ヒーローセクション・大きなバナー | デスクトップアプリに不適切 | コンパクトなヘッダー |
| 装飾的な区切り線 | 不要な視覚要素 | `BORDER.dividerX` またはスペーシング |
| カラフルなタグ/バッジの乱用 | 情報過多 | テキストまたは単色バッジ |
| ホバーカード/ツールチップの過剰使用 | 操作を阻害 | 必要な情報はインラインで表示 |
| ステップインジケーター | 過剰な構造化 | シンプルなリスト |
| プログレスリング/円グラフ | UIの複雑化 | テキストまたはプログレスバー |
| 背景パターン/テクスチャ | 既存のglass背景と競合 | 背景は既存のgradient+glassのみ |

---

## コンポーネント設計ルール

### 新規コンポーネント作成の判断フロー

```
要件を確認
  ↓
既存コンポーネント（src/components/ui/）で実現可能？
  → Yes: 既存を使用。variant追加で対応可能なら variant を追加
  → No: ↓
既存コンポーネントの組み合わせで実現可能？
  → Yes: 組み合わせで実装
  → No: ↓
新規コンポーネントを作成（CVA + Radix UI パターンに従う）
```

### CVA パターン（必須）

新規コンポーネントは必ず CVA (class-variance-authority) パターンで作成する。

```typescript
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/components/lib/utils';

const myComponentVariants = cva(
  // ベーススタイル: 最小限の共通スタイル
  'inline-flex items-center transition-all duration-200',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        // variant名は既存コンポーネントに揃える
      },
      size: {
        sm: 'text-xs px-2 py-1',
        default: 'text-sm px-3 py-2',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);
```

### Glass morphism の使用基準

| 要素 | Glass 使用 | 理由 |
|------|-----------|------|
| メインコンテンツ領域 | ✕ | コンテンツの視認性優先 |
| ヘッダー/ツールバー | △ | `minimal-header` クラスのみ |
| ダイアログ/モーダル | ○ | `glass-panel` クラスを使用 |
| ボタン (primary) | ○ | `glass-button` クラスを使用 |
| カード | △ | `glass-card` - 情報がグルーピングされる場合のみ |
| 入力フィールド | ✕ | 背景透過は入力の邪魔 |

---

## UX 設計ルール

### 情報アーキテクチャ

**1画面に表示する情報は最小限にする。**

```
判断基準:
- この情報は今この瞬間に必要か？ → No なら非表示
- ユーザーが次に取る行動は何か？ → その行動に必要な情報だけ表示
- 初見のユーザーが迷わないか？ → ラベルとアクションを明確に
```

### インタラクション設計

| 原則 | 説明 | 例 |
|------|------|-----|
| 即時フィードバック | ユーザー操作に対し 100ms 以内に反応 | ボタンのホバー/プレス状態 |
| 予測可能性 | 同じ操作は同じ結果を生む | すべてのアイコンボタンに同じホバー効果 |
| エラー防止 | 取り消せない操作には確認を | 削除前のダイアログ |
| 現在地の明示 | ユーザーが今どこにいるか分かる | アクティブ状態の視覚表示 |

### フォーム設計

```typescript
// ✅ 正しいフォームパターン
<div className={SPACING.stack.default}>
  <div className={SPACING.stack.tight}>
    <Label htmlFor="field">{t('label.key')}</Label>
    <Input id="field" />
    {/* 説明文は入力フィールドの直下に配置 */}
    <p className={TYPOGRAPHY.caption.default}>{t('description.key')}</p>
  </div>
</div>

// ❌ 禁止: アイコン付きラベル、過剰なヘルプテキスト、ツールチップ
```

### ボタン配置

```
ルール:
- プライマリアクション（保存、確定）は右寄せ
- デストラクティブアクション（削除）は左寄せまたは分離
- キャンセルはプライマリの左隣
- ボタン間の間隔: gap-2 (8px)
```

```typescript
// ✅ 正しいボタン配置
<div className="flex justify-end gap-2">
  <Button variant="outline">{t('common.cancel')}</Button>
  <Button variant="default">{t('common.save')}</Button>
</div>
```

### 空状態の設計

```typescript
// ✅ シンプルな空状態
<div className="flex flex-col items-center justify-center py-12">
  <p className={cn(TYPOGRAPHY.body.primary, TEXT_COLOR.secondary)}>
    {t('empty.message')}
  </p>
  {/* アクションが必要な場合のみボタンを配置 */}
  <Button variant="outline" className="mt-4">
    {t('empty.action')}
  </Button>
</div>

// ❌ 禁止: 大きなイラスト、装飾的なアイコン、長い説明文
```

### ローディング状態

```typescript
// ✅ 正しいローディング表示
// 短時間（< 1秒）: 何も表示しない（ちらつき防止）
// 中時間（1-3秒）: インラインスピナー
<RefreshCw className={cn(ICON_SIZE.sm.class, 'animate-spin')} />

// 長時間（> 3秒）: プログレス表示
<div className="flex items-center gap-2">
  <RefreshCw className={cn(ICON_SIZE.sm.class, 'animate-spin')} />
  <span className={TYPOGRAPHY.body.primary}>{t('loading.message')}</span>
</div>

// ❌ 禁止: フルスクリーンローディング、スケルトンUI（このアプリには過剰）
```

---

## ダークモード・ライトモード対応

### 基本ルール

- **セマンティックトークンを使えば自動対応される。** `dark:` プレフィックスの手動指定は原則不要。
- `bg-background`, `text-foreground`, `border-border` 等の CSS 変数ベースのクラスを使えば、テーマ切り替えは自動。

### `dark:` が必要な場合（例外）

```typescript
// 例外: スクロールバーなど CSS 変数化されていない部分
className="bg-gray-100 dark:bg-gray-900"

// この場合でも可能な限り CSS 変数化を検討する
```

---

## テキストとi18n

### 必須ルール

- **UIに表示するすべてのテキストは `t()` 関数経由にする。** ハードコードされた日本語/英語テキストは禁止。
- 翻訳キーは `ja.ts` と `en.ts` の両方に追加する。

```typescript
// ❌ 禁止
<p>写真が見つかりません</p>

// ✅ 正しい
const { t } = useI18n();
<p>{t('photos.empty')}</p>
```

---

## レイアウトパターン

### このアプリの構造

```
┌─────────────────────────────────────────┐
│ AppHeader (h-11, draggable)             │
│ [Settings] [Search...] [_][□][×]        │
├─────────────────────────────────────────┤
│                                         │
│  PhotoGrid (justified layout)           │
│  ┌─ LocationGroupHeader (h-24) ────┐    │
│  │ [WorldImg] WorldName   [Share]  │    │
│  ├─────────────────────────────────┤    │
│  │ [Photo][Photo][Photo][Photo]    │    │
│  │ [Photo][Photo][Photo]           │    │
│  ├─ LocationGroupHeader ──────────┤    │
│  │ ...                             │    │
│  └─────────────────────────────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

### 新規画面追加時の注意

- ヘッダー高さ `h-11` は固定。コンテンツ領域は `calc(100vh - 44px)` で計算
- サイドバーは現在未使用。追加する場合は全体レイアウトへの影響を検討
- モーダル/ダイアログは Radix UI Dialog を使用（`src/components/ui/dialog.tsx`）
- 設定画面は既存のダイアログパターンを踏襲

---

## 実装チェックリスト

UI変更をコミットする前に確認:

- [ ] デザイントークン（`src/v2/constants/ui.ts`）のみを使用しているか
- [ ] 既存コンポーネント（`src/components/ui/`）を最大限活用しているか
- [ ] 色の直接指定（`bg-blue-500` 等）をしていないか
- [ ] 不要な装飾（グラデーション、過剰なシャドウ、アニメーション）がないか
- [ ] ダークモード・ライトモード両方で視認性に問題がないか
- [ ] アイコンは目的があり、`ICON_SIZE` トークンでサイズ指定しているか
- [ ] テキストは `t()` 関数経由か
- [ ] スペーシングは 8px グリッドに沿っているか
- [ ] 新規コンポーネントは CVA パターンに従っているか
- [ ] 「この要素を削除しても機能するか？」のテストをしたか

---

## 参照ファイル

| ファイル | 内容 |
|---------|------|
| `src/v2/constants/ui.ts` | デザイントークン（TYPOGRAPHY, SPACING, ICON_SIZE, TEXT_COLOR, SURFACE_COLOR, STATUS_COLOR, BORDER） |
| `src/v2/constants/layoutConstants.ts` | レイアウト定数（行高さ、ギャップ、ヘッダー高さ） |
| `src/components/ui/button.tsx` | Button コンポーネント（variant パターンの参照実装） |
| `src/components/ui/dialog.tsx` | Dialog コンポーネント（モーダルの参照実装） |
| `src/components/ui/toast.tsx` | Toast コンポーネント（通知の参照実装） |
| `src/components/ui/input.tsx` | Input コンポーネント |
| `src/components/lib/utils.ts` | `cn()` ユーティリティ |
| `src/index.css` | Glass morphism ユーティリティ、CSS変数定義 |
| `tailwind.config.js` | カスタムテーマ設定 |
| `src/v2/i18n/` | 国際化システム |
