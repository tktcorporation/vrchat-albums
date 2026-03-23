# 日付ジャンプ機能アーキテクチャ

## 概要

写真ギャラリーに日付ベースのナビゲーション機能を追加。Google PhotoやIMMICHのような、サイドバーから特定の日付にジャンプできる機能を実装する。

## 設計方針

### 1. データ構造

```typescript
// 日付インデックスマップ
interface DateIndex {
  dateToGroups: Map<string, number[]>; // "YYYY-MM-DD" → [groupIndex...]
  sortedDates: string[]; // ソート済み日付リスト
  groupToDates: Map<number, string>; // groupIndex → "YYYY-MM-DD"
}

// 日付サマリー（UI表示用）
interface DateSummary {
  date: string; // "YYYY-MM-DD"
  label: string; // "12月15日"
  photoCount: number; // その日の写真総数
  groupIndices: number[]; // 関連するグループインデックス
  year?: string; // 年が変わる時のみ
  month?: string; // 月が変わる時のみ
}
```

### 2. コンポーネント構造

```
PhotoGallery
├── GalleryContent (バーチャルスクロール)
└── DateJumpSidebar (新規)
    ├── DateList (日付リスト表示)
    └── DateItem (個別日付アイテム)
```

### 3. スクロール同期戦略

- **ジャンプ時**: `virtualizer.scrollToIndex()` を使用
- **スクロール追従**: IntersectionObserver で現在表示中の日付を検知
- **データロード**: 既存のクエリシステムが自動的に必要なデータをロード

### 4. UI/UX設計

```
┌─────────────────────────────┬─────┐
│                             │ 2024│
│  LocationGroupHeader        │ ────│
│  ┌───┬───┬───┐            │ 12月│
│  │   │   │   │            │  15 │ ← 現在位置
│  └───┴───┴───┘            │  14 │
│                             │  13 │
│  LocationGroupHeader        │ ────│
│  ┌───┬───┬───┐            │ 11月│
│  │   │   │   │            │  30 │
│  └───┴───┴───┘            │  29 │
└─────────────────────────────┴─────┘
```

### 5. パフォーマンス最適化

- 日付インデックスは初回レンダリング時に一度だけ生成
- サイドバーはメモ化して不要な再レンダリングを防止
- スクロール位置の更新はthrottleで制御（100ms）
- 大量の日付がある場合は仮想化を検討

## 実装計画

### Phase 1: DateJumpSidebar コンポーネント

1. 基本的な日付リスト表示
2. クリックハンドラーの実装
3. スタイリング（固定位置、スクロール可能）

### Phase 2: GalleryContent との統合

1. 日付インデックスの生成
2. virtualizer インスタンスの共有
3. scrollToIndex の実装

### Phase 3: スクロール同期

1. IntersectionObserver の設定
2. 現在の日付のハイライト
3. スムーズスクロールの調整

### Phase 4: 最適化

1. パフォーマンス測定
2. 必要に応じて日付リストの仮想化
3. アニメーションの調整

## 技術的考慮事項

### tanstack/virtual との統合

- `scrollToIndex` は要素の高さが必要なため、未測定のグループは推定値を使用
- ジャンプ後に実際の高さを測定して位置を調整
- `behavior: 'smooth'` でスムーズスクロール

### 日付フォーマット

- 内部: ISO形式 "YYYY-MM-DD" (タイムゾーン非依存)
- 表示: ローカライズされた形式（i18n対応）

### エッジケース

- 日付が1つしかない場合
- 写真が大量にある日（1000枚以上）
- 年をまたぐ表示
