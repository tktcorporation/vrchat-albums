# デザインシステム

VRChat Albumsアプリケーションのデザイントークンとコンポーネントガイド。

## デザイントークン

全てのトークンは `src/v2/constants/ui.ts` で定義されています。

### スペーシング (`SPACING`)

4pxベースのスペーシングスケール。

```typescript
import { SPACING } from '@/v2/constants/ui';

// 縦方向の間隔
<div className={SPACING.stack.tight}>     // space-y-1 (4px)
<div className={SPACING.stack.default}>   // space-y-2 (8px)
<div className={SPACING.stack.relaxed}>   // space-y-4 (16px)
<div className={SPACING.stack.loose}>     // space-y-6 (24px)

// 横方向の間隔
<div className={SPACING.inline.tight}>    // gap-1 (4px)
<div className={SPACING.inline.default}>  // gap-2 (8px)
<div className={SPACING.inline.relaxed}>  // gap-3 (12px)
<div className={SPACING.inline.loose}>    // gap-4 (16px)

// パディング
<div className={SPACING.padding.card}>    // p-4
<div className={SPACING.padding.section}> // p-6
```

### テキストカラー (`TEXT_COLOR`)

セマンティックなテキストカラー。gray-XXXの直接指定を避ける。

```typescript
import { TEXT_COLOR } from '@/v2/constants/ui';

<span className={TEXT_COLOR.primary}>   // text-foreground
<span className={TEXT_COLOR.secondary}> // text-muted-foreground
<span className={TEXT_COLOR.muted}>     // text-muted-foreground/60
<span className={TEXT_COLOR.accent}>    // text-primary
```

**移行マッピング:**
| Before | After |
|--------|-------|
| `text-gray-900 dark:text-white` | `TEXT_COLOR.primary` |
| `text-gray-700 dark:text-gray-300` | `TEXT_COLOR.secondary` |
| `text-gray-500 dark:text-gray-400` | `TEXT_COLOR.muted` |
| `text-indigo-600 dark:text-indigo-400` | `TEXT_COLOR.accent` |

### サーフェスカラー (`SURFACE_COLOR`)

背景色のセマンティックトークン。

```typescript
import { SURFACE_COLOR } from '@/v2/constants/ui';

<div className={SURFACE_COLOR.default}> // bg-background
<div className={SURFACE_COLOR.muted}>   // bg-muted
<div className={SURFACE_COLOR.card}>    // bg-card
<div className={SURFACE_COLOR.glass}>   // bg-glass backdrop-blur-md
```

### ステータスカラー (`STATUS_COLOR`)

成功・警告・エラー・情報の表示用。

```typescript
import { STATUS_COLOR } from '@/v2/constants/ui';

// 各ステータスには bg, text, border が含まれる
<div className={`${STATUS_COLOR.success.bg} ${STATUS_COLOR.success.text}`}>
<div className={`${STATUS_COLOR.warning.bg} ${STATUS_COLOR.warning.border}`}>
<div className={`${STATUS_COLOR.error.bg} ${STATUS_COLOR.error.text}`}>
```

### タイポグラフィ (`TYPOGRAPHY`)

見出し・本文・キャプションのスタイル。

```typescript
import { TYPOGRAPHY } from '@/v2/constants/ui';

// 見出し
<h1 className={TYPOGRAPHY.heading.page}>      // text-2xl font-bold
<h2 className={TYPOGRAPHY.heading.section}>   // text-lg font-semibold
<h3 className={TYPOGRAPHY.heading.subsection}>// text-base font-medium
<label className={TYPOGRAPHY.heading.label}>  // text-sm font-medium

// 本文
<p className={TYPOGRAPHY.body.default}>  // text-sm
<p className={TYPOGRAPHY.body.small}>    // text-xs
<p className={TYPOGRAPHY.body.emphasis}> // text-sm font-medium

// キャプション
<span className={TYPOGRAPHY.caption.default}> // text-xs text-muted-foreground
<span className={TYPOGRAPHY.caption.meta}>    // text-xs text-muted-foreground/60
```

## UIコンポーネント

### Badge (`src/components/ui/badge.tsx`)

ステータス表示、タグ、ラベル用。

```tsx
import { Badge } from '@/components/ui/badge';

<Badge>Default</Badge>
<Badge variant="success">Complete</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="error">Failed</Badge>
<Badge variant="glass">Glass Effect</Badge>
<Badge size="lg">Large</Badge>
```

**Variants:** `default`, `secondary`, `success`, `warning`, `error`, `info`, `glass`, `outline`
**Sizes:** `sm`, `default`, `lg`

### Card (`src/components/ui/card.tsx`)

コンテンツコンテナ。

```tsx
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

<Card variant="glass" padding="lg">
  <CardHeader>
    <CardTitle>タイトル</CardTitle>
  </CardHeader>
  <CardContent>コンテンツ</CardContent>
</Card>
```

**Variants:** `default`, `glass`, `elevated`, `ghost`, `outline`
**Padding:** `none`, `sm`, `md`, `default`, `lg`

### Text & Heading (`src/components/ui/text.tsx`)

タイポグラフィコンポーネント。

```tsx
import { Text, Heading } from '@/components/ui/text';

<Heading level={1}>ページタイトル</Heading>
<Heading level={2}>セクション</Heading>
<Text variant="body">本文テキスト</Text>
<Text variant="caption" color="muted">キャプション</Text>
```

## Lintルール

### GritQLパターン

`.grit/patterns/` に定義されたパターンでドリフトを検出：

- `no_hardcoded_gray.md` - gray-XXXの直接使用を検出
- `no_hardcoded_indigo.md` - indigo-XXXの直接使用を検出

## 移行ガイド

### Before → After 例

```tsx
// Before: ハードコードされた色とスペーシング
<div className="text-gray-700 dark:text-gray-300 space-y-4 p-6">
  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
    Title
  </h2>
</div>

// After: デザイントークン使用
<div className={`${TEXT_COLOR.secondary} ${SPACING.stack.relaxed} ${SPACING.padding.section}`}>
  <h2 className={`${TYPOGRAPHY.heading.section} ${TEXT_COLOR.primary}`}>
    Title
  </h2>
</div>
```

## ベストプラクティス

1. **新規コードではトークンを使用** - gray/indigoなどの直接指定を避ける
2. **コンポーネントを活用** - Badge, Card, Textなどの共通コンポーネントを使う
3. **段階的移行** - 既存コードは優先度順に移行
4. **Lintで検証** - `yarn lint` でGritQLパターン違反をチェック
