# 参照UIコンポーネントライブラリ カタログ

UIを実装する前にここから適切なライブラリを選び、ベースコンポーネントを探す。
ゼロから作るのではなく、既存の高品質コンポーネントをカスタマイズするアプローチを取る。

## 目次

1. [コピペ型・AI親和性高（最優先）](#1-コピペ型ai親和性高最優先)
2. [AI生成ツールのベース](#2-ai生成ツールのベース)
3. [大規模コンポーネントコレクション](#3-大規模コンポーネントコレクション)
4. [UIパーツ検索用リスト](#4-uiパーツ検索用リスト)
5. [UIパターン集（デザイン参考）](#5-uiパターン集デザイン参考)

---

## 1. コピペ型・AI親和性高（最優先）

### Magic UI

- URL: https://magicui.design
- スタック: React + Tailwind + Motion (framer-motion)
- コンポーネント数: 150+
- 特徴: アニメーションUIに特化。shadcn と相性が良い
- 得意分野:
  - animated grid / bento grid
  - spotlight hover effects
  - text reveal animations
  - particle / aurora backgrounds
  - number ticker / counting animations
  - marquee / scroll-based animations
- 使い方: Context7 で `magicui` を検索してドキュメント取得
- いつ使う: ランディングページ、hero セクション、動きのあるUIが必要なとき

### Aceternity UI

- URL: https://ui.aceternity.com
- スタック: React + Framer Motion + Tailwind
- コンポーネント数: 200+
- 特徴: ランディングページ向けのリッチなアニメーションコンポーネント
- 得意分野:
  - spotlight hero sections
  - 3D card effects
  - glass morphism cards
  - gradient hover effects
  - parallax scroll sections
  - floating navbar
  - infinite moving cards
- いつ使う: v0風のモダンUI、印象的なファーストビューが必要なとき

### UIverse

- URL: https://uiverse.io
- スタック: HTML/CSS/React
- 特徴: UIの Pinterest。コミュニティ投稿型のUIパーツ集
- 得意分野:
  - glowing buttons
  - creative toggle switches
  - loading animations
  - micro interactions
  - creative form inputs
  - animated checkboxes
- いつ使う: 小さいUIパーツで個性を出したいとき。ボタンやトグルの見た目参考

---

## 2. AI生成ツールのベース

### shadcn/ui（最重要）

- URL: https://ui.shadcn.com
- スタック: Radix UI + Tailwind CSS
- 特徴: コピペ型。CLIで追加。v0/bolt のベース
- 得意分野:
  - Dialog / Sheet / Drawer
  - Dropdown / Context Menu
  - Form / Input / Select
  - Table / Data Table
  - Tabs / Accordion
  - Toast / Sonner
  - Command palette (cmdk)
- なぜ最重要か:
  - Tailwind ネイティブ
  - アクセシビリティが Radix UI で担保
  - コンポーネント構造が LLM に理解しやすい
  - カスタマイズ前提の設計
- 使い方: Context7 で `shadcn` を検索
- いつ使う: ほぼ全ての UI 実装の出発点

### Radix UI

- URL: https://www.radix-ui.com
- 特徴: headless UI プリミティブ。shadcn/ui の基盤
- 得意分野: dialog, dropdown, popover, toast, tooltip, tabs
- いつ使う: shadcn/ui を使わずに Radix 直接使いたいとき、またはカスタムスタイルが必要なとき

### Headless UI

- URL: https://headlessui.com
- 特徴: Tailwind Labs 製。ロジックのみ提供
- いつ使う: Vue プロジェクト、または Radix の代替が必要なとき

---

## 3. 大規模コンポーネントコレクション

### Mantine

- URL: https://mantine.dev
- コンポーネント数: 100+
- 特徴: hooks 充実、dark theme ネイティブ
- 得意分野: フォーム、日付ピッカー、通知、リッチテキスト
- いつ使う: shadcn/ui にないコンポーネントが必要なとき（date picker, color picker 等）

### Chakra UI

- URL: https://chakra-ui.com
- 特徴: DX 重視、theme system
- いつ使う: Chakra ベースのプロジェクト

### MUI (Material UI)

- URL: https://mui.com
- 特徴: エンタープライズ向け。完成度高い
- いつ使う: Material Design 準拠が求められるプロジェクト

### Tremor

- URL: https://tremor.so
- 特徴: ダッシュボード・データ可視化特化
- 得意分野: チャート、KPI カード、テーブル、スパークライン
- いつ使う: ダッシュボード・管理画面・分析系 UI

---

## 4. UIパーツ検索用リスト

特定のUIパーツを探すときに参照する。

### awesome-react-components

- URL: https://github.com/brillout/awesome-react-components
- 特徴: React コンポーネントの巨大キュレーションリスト
- 使い方: 特定のUI要素（例: drag & drop, virtualized list, color picker）を探すとき

### awesome-ui-libraries

- URL: https://github.com/dalisoft/awesome-ui-libraries
- 特徴: フレームワーク横断の UI ライブラリリスト

---

## 5. UIパターン集（デザイン参考）

コードではなくデザインパターンの参考。「この画面はどういうレイアウトが一般的か」を知りたいときに使う。

### Mobbin

- URL: https://mobbin.com
- 特徴: 実際のアプリのUI/UXスクリーンショット集
- 使い方: 「onboarding のUIパターンを見たい」「設定画面のベストプラクティスは？」等

### Pageflows

- URL: https://pageflows.com
- 特徴: UXフロー（複数画面にまたがるフロー）の参考

### UI Garage

- URL: https://uigarage.net
- 特徴: カテゴリ別UIパターン集

---

## ライブラリ選択のフローチャート

```
作りたいUIは何？
├── フォーム/データ入力系 → shadcn/ui を Context7 で検索
├── ダッシュボード/チャート → Tremor + shadcn/ui
├── ランディングページ → Aceternity UI or Magic UI
├── アニメーション/演出 → Magic UI → 足りなければ Aceternity UI
├── 小さなUIパーツ（ボタン, トグル等） → UIverse で検索 → shadcn/ui
├── 複雑なコンポーネント（date picker等） → Mantine or shadcn/ui
└── わからない → shadcn/ui から始める
```

## Context7 での検索方法

```
1. resolve-library-id で対象ライブラリの ID を取得
   例: "shadcn ui", "magic ui", "aceternity ui"

2. query-docs で具体的なコンポーネントのドキュメントを取得
   例: topic="button component", topic="data table"
```

ドキュメントにコード例が含まれるので、それをベースにカスタマイズする。
