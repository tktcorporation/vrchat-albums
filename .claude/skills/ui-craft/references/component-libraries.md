# 参照UIコンポーネントライブラリ カタログ

プロジェクト内の既存コンポーネントと、プロジェクトが既に使っている UI ライブラリに出発点が無いときに、ここから選ぶ。
新しいライブラリを持ち込むと依存と見た目の系統が 1 つ増えるので、既存の系統で足りるならそちらを使う。

## 目次

1. [演出・アニメーション系](#1-演出アニメーション系)
2. [headless / コピー型の基盤](#2-headless--コピー型の基盤)
3. [大規模コンポーネントコレクション](#3-大規模コンポーネントコレクション)
4. [UIパーツ検索用リスト](#4-uiパーツ検索用リスト)
5. [UIパターン集（デザイン参考）](#5-uiパターン集デザイン参考)

---

## 1. 演出・アニメーション系

このカテゴリの得意分野（光るボーダー、スポットライト、グラスモーフィズム、パーティクル背景）は、そのまま使うと AI 生成の画面に典型的な見た目になる。
使うのは、演出が画面の目的に効く場面（製品の第一印象を作るランディングページのファーストビューなど）に限り、1 画面に 1 つまでに絞る。
業務画面・管理画面・フォームには使わない。

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
- いつ使う: 印象的なファーストビューが必要で、演出を 1 か所に絞れるとき

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
- いつ使う: 印象的なファーストビューが必要で、演出を 1 か所に絞れるとき

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
- いつ使う: ランディングページの小さなパーツに個性を出したいとき。業務画面のボタンやフォームの参考にはしない

---

## 2. headless / コピー型の基盤

### shadcn/ui

- URL: https://ui.shadcn.com
- スタック: Radix UI + Tailwind CSS
- 特徴: コピペ型。CLIで追加し、プロジェクトのコードとして持つ
- 得意分野:
  - Dialog / Sheet / Drawer
  - Dropdown / Context Menu
  - Form / Input / Select
  - Table / Data Table
  - Tabs / Accordion
  - Toast / Sonner
  - Command palette (cmdk)
- 出発点に向く理由:
  - Tailwind ネイティブ
  - アクセシビリティが Radix UI で担保
  - コンポーネント構造が LLM に理解しやすい
  - カスタマイズ前提の設計
- いつ使う: プロジェクトに UI ライブラリが無く、React と Tailwind を使っているときの出発点

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
プロジェクト内に近いコンポーネントや画面がある？
├── ある → それを使う（このカタログは読まない）
└── ない → プロジェクトが既に使っている UI ライブラリに該当コンポーネントがある？
    ├── ある → それを使う
    └── ない → どのスタック？
        ├── React 以外 → そのフレームワーク向けの headless ライブラリ（Vue なら Headless UI など）を探す
        ├── React で Tailwind なし → Radix UI をプロジェクトの CSS の書き方でスタイルする
        └── React と Tailwind → 作りたいUIは何？
            ├── フォーム/データ入力系 → shadcn/ui
            ├── ダッシュボード/チャート → Tremor + shadcn/ui
            ├── 複雑なコンポーネント（date picker等） → Mantine or shadcn/ui
            ├── 小さなUIパーツ（ボタン, トグル等） → shadcn/ui
            ├── ランディングページの演出 → Magic UI or Aceternity UI（1 か所に絞る）。小さなパーツの見た目の参考に UIverse
            └── わからない → shadcn/ui から始める
```

## ドキュメントの取得

ライブラリのドキュメント取得用の MCP（ライブラリ ID を解決してからトピックでドキュメントを引く種類のもの）が使える環境なら、それで最新版のコード例を読む。
訓練データ上の古い API で書くと、型エラーや非推奨の警告が出る。
使えない環境では、各ライブラリの公式サイトを読む。

コード例はプロジェクトのデザイントークンと既存画面の書き方に合わせて書き換えてから使う。
