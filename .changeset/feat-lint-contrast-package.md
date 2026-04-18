---
'vrchat-albums': patch
---

build: デザインシステム・コントラスト静的検証ツール `@vrchat-albums/lint-contrast` を packages/ 配下に独立パッケージとして追加

新規の内部開発ツール。`pnpm lint:contrast` でライト/ダーク両モードの WCAG AA コントラストを JSX AST 走査により静的検証する。ユーザー向けの機能変更はなく、本体パッケージの devDependencies 整理 (`oxc-parser` / `culori` 等を新パッケージ側へ移動) とルート scripts への委譲コマンド追加のみ。
