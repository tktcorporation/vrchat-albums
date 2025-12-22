# Changelog

All notable changes to this project will be documented in this file.

## [0.20.0] - 2025-12-22

### 🚀 Features

- DB→logStore逆変換機能とエクスポート機能の実装 (#440) (#441)
- エクスポート先に日時付きサブフォルダを作成 (#442)
- Improve export functionality with default full-period mode and timezone handling (#446)
- バックアップエクスポート、インポート機能の実装 (#449)
- 検索候補選択時の検索タイプ明示的指定機能を追加 (#458)
- 旧アプリからのデータ移行機能を実装 (#463)
- ローディングアニメーションを追加 (#466)
- 初回起動時の自動起動設定をデフォルトTrueに変更 (#467)
- 写真クリック時にOSの標準写真ビューアーで開くように変更 (#475)
- 写真コピー機能を画像データコピーからファイルパスコピーに変更 (#481)
- 旧アプリからのデータ移行機能を再実装（Playwrightテスト対応版） (#463) (#488)
- 写真ギャラリーに日付ジャンプサイドバーを実装 (#489)
- 写真ギャラリーに日付ジャンプサイドバー機能を実装 (#495)
- 写真選択UIをモダンでシンプルなデザインに改善 (#497)
- ランディングページの実装とTailwind CSS v4への移行 (#532)
- VRChat Albums紹介用ランディングページの実装 (#533)
- *(#529)* ウィンドウヘッダーのダブルクリックで最大化/復元機能 (#537)
- Improve instance type display with confidence-based detection (#558)
- Remove photo count display from LocationGroupHeader (#561)
- Claude Code v2のベストプラクティスとlinterシステムの実装 (#617)
- 利用規約をMarkdown形式に変換しスタイル・内容を改善 (#619)
- Upgrade Electron to v39 for Node.js 22 compatibility (#632)

### 🐛 Bug Fixes

- Optimize session batch processing with PhotoAsLog integration and timeout improvements (#435)
- Improve cache key strategy for session player lists to prevent data integrity issues (#436)
- Remove session duration limits and optimize query performance (#437)
- AppendLoglinesToFile now properly appends instead of overwriting (#439)
- Resolve session boundary issues in player grouping for search (#452)
- PlayerName検索のパフォーマンス最適化 (#457)
- ワールドリンクのURL構造を修正 (#460)
- 日付ジャンプサイドバーがアプリケーションヘッダーと重なる問題を修正 (#503)
- App trayの項目整理とアイコンクリック動作を追加 (#505)
- I18nの漏れを修正 (#502)
- フォトギャラリーのグループ間の余白を適切なサイズに調整 (#506)
- Primary colorの不一致を修正 (#504)
- 入力要素のスタイル統一とSSH agent forwarding設定 (#526) (#527)
- *(#476)* UIコンポーネントのprimary color統一 (#535)
- ランディングページのビルドエラーを修正 (#543)
- *(#549)* LogLoad中のエラーハンドリングを改善し、部分的な成功を許容 (#551)
- Replace wildcard pattern in sentry:sourcemaps script with explicit script names (#571)
- Improve light mode contrast by making foreground elements brighter (#574)
- Update LP image references to use playwright/previews images (#578)
- Automate landing page screenshot sync from playwright tests (#581)
- Automate landing page screenshot sync and UI improvements (#583)
- 右クリック写真コピーで全選択写真をコピーできない問題を修正 (#587)
- Screenイベントリスナーのクリーンアップ処理を追加 (#589)
- Restrict platform display to Windows only in landing page (#590)
- プラットフォーム別アプリアイコンの自動生成システムを実装 (#597)
- 初回起動時以外でも「初期化中」と表示される問題を修正 (#610)
- GitHub Actionsワークフローの依存関係インストール処理を統一 (#612)
- Yarn workspaceの依存関係インストール問題を修正 (#613)
- Yarn workspaceの依存関係とLanding Pageデプロイワークフローを修正 (#614)
- Grit CLIをdevDependenciesに追加してCIのlintエラーを修正 (#621)
- TsxをdevDependenciesに追加してnpx依存を解消 (#622)

### 🚜 Refactor

- Improve error handling with structured error info and user-friendly toast notifications (#448)
- ログファイルパス取得とフォトインデックス処理を最適化 (#480)
- Replace if statements with ts-pattern in App.tsx (#514)
- Consolidate error helper functions to reduce duplication (#528)
- Apply ts-pattern to startup stage handling (#522)
- Phase 1 - Consolidate duplicate code patterns (#531)
- アイコンサイズの統一と定数化 (#542)
- *(#538)* Transition durationの統一 (#540)
- TRPCエラーハンドリング、Sentryフィルタリング、利用規約改善 (#501)
- Eliminate code duplication in logFileReader.ts (#560)

### 📚 Documentation

- Update README with current features and improved user guide (#451)

### ⚡ Performance

- プレーヤー名表示の遅延を大幅改善 (#483)
- ログファイル読み込みのパフォーマンスとスケーラビリティを大幅改善 (#486)

### 🎨 Styling

- Lighten glass-panel shadow for better visual weight (#567)

### 🧪 Testing

- ValueObjectの型安全性向上とテスト修正 (#450)

### ⚙️ Miscellaneous Tasks

- エラーハンドリングとプレイヤーアクションパーシングの堅牢性向上 (#565)
- Upgrade Zod to v4.0.5 (#573)
- Release v0.19.0 (#592)
- Remove unused icon files and update electron-builder configuration (#595)
- 開発環境設定の改善とMCPサーバー統合 (#596)
- ドキュメントの整理とXML検証ツールの追加 (#600)
- 依存関係の包括的アップデートとバージョン管理改善 (#601)
- Update dependencies to latest minor and patch versions (#603)
- コンテナ環境でのElectron起動に--no-sandboxオプションを追加 (#604)
- Update landing page dependencies to latest patch versions (#605)
- Upgrade 12 major dependencies including React 19, tRPC v11, TanStack Query v5 (#606)
- Chrome DevTools MCPサーバーと開発環境の設定追加 (#615)
- 開発環境設定の改善 (#627)

<!-- generated by git-cliff -->
