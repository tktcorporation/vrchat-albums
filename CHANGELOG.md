# Changelog

## 0.29.3

### Patch Changes

- [#777](https://github.com/tktcorporation/vrchat-albums/pull/777) [`0134441`](https://github.com/tktcorporation/vrchat-albums/commit/01344419277d752e759e8287daa4aa6adcccd9a4) Thanks [@tktcorporation](https://github.com/tktcorporation)! - feat: ネイティブモジュールの asarUnpack/hoist 整合性チェック lint を追加

  napi-rs 系ネイティブモジュールの asarUnpack 入れ忘れや public-hoist-pattern の
  設定漏れを CI で自動検知するスクリプトを追加。

- [#774](https://github.com/tktcorporation/vrchat-albums/pull/774) [`0f7c99f`](https://github.com/tktcorporation/vrchat-albums/commit/0f7c99f830963fd9b2bf72d8cef4b80b66efe950) Thanks [@tktcorporation](https://github.com/tktcorporation)! - fix: clip-filepaths のプラットフォーム固有バイナリを asarUnpack に含める

  electron-builder の asarUnpack パターンで clip-filepaths のプラットフォーム固有パッケージ
  （clip-filepaths-win32-x64-msvc 等）が含まれていなかったため、Windows でアプリ起動時に
  「Cannot find module 'clip-filepaths-win32-x64-msvc'」エラーが発生していた問題を修正。

- [#776](https://github.com/tktcorporation/vrchat-albums/pull/776) [`2eafec4`](https://github.com/tktcorporation/vrchat-albums/commit/2eafec4ad366ab7f7899212e835c1149d7c5f3c1) Thanks [@tktcorporation](https://github.com/tktcorporation)! - fix: clip-filepaths のプラットフォーム固有パッケージを pnpm でホイストする

  .npmrc の public-hoist-pattern に clip-filepaths のみが指定されており、
  プラットフォーム固有パッケージ（clip-filepaths-win32-x64-msvc 等）がホイストされて
  いなかった。pnpm の isolated モードではこれらが node_modules/.pnpm/ 内に配置される
  ため、electron-builder の asarUnpack パターンに一致せず、asar 内に閉じ込められて
  ランタイムで "Cannot find module" エラーが発生していた。

- [#772](https://github.com/tktcorporation/vrchat-albums/pull/772) [`a5e1162`](https://github.com/tktcorporation/vrchat-albums/commit/a5e11628e6338819919eb2c1e38537138250a5a9) Thanks [@tktcorporation](https://github.com/tktcorporation)! - fix: ネイティブバインディングが見つからないエラーを修正

  pnpm の isolated node_modules 構造で、@napi-rs/image 等のプラットフォーム固有の
  オプショナル依存パッケージが electron-builder のパッケージングに含まれない問題を修正。
  .npmrc に public-hoist-pattern を追加し、ネイティブモジュールをホイストするようにした。

## 0.29.2

### Patch Changes

- [#770](https://github.com/tktcorporation/vrchat-albums/pull/770) [`11a7072`](https://github.com/tktcorporation/vrchat-albums/commit/11a707236abee8569a7ad300fe64447418844706) Thanks [@tktcorporation](https://github.com/tktcorporation)! - oxlint でカバー済みの lint-floating-promises と不要な lint-neverthrow を削除

## 0.29.1

### Patch Changes

- [#767](https://github.com/tktcorporation/vrchat-albums/pull/767) [`0fe6df6`](https://github.com/tktcorporation/vrchat-albums/commit/0fe6df6a8331a628716e8b7753350c21b0f0a15b) Thanks [@tktcorporation](https://github.com/tktcorporation)! - 未知ログパターン検知の Sentry 大量送信を抑制

## 0.29.0

### Minor Changes

- [#765](https://github.com/tktcorporation/vrchat-albums/pull/765) [`3ad0ec6`](https://github.com/tktcorporation/vrchat-albums/commit/3ad0ec60360956605bf37a12cd02f5b6675e8e6e) Thanks [@tktcorporation](https://github.com/tktcorporation)! - アプリ情報画面にアップデート確認・インストール機能を追加

- [#763](https://github.com/tktcorporation/vrchat-albums/pull/763) [`307cfcf`](https://github.com/tktcorporation/vrchat-albums/commit/307cfcfea8185761bcb63e84cbbc209f88b2f2c0) Thanks [@tktcorporation](https://github.com/tktcorporation)! - Vite 8 + Rolldown へのアップグレード。バンドラーが Rolldown（Rust 製）に統一され、ビルド速度が向上。

## 0.28.2

### Patch Changes

- [#761](https://github.com/tktcorporation/vrchat-albums/pull/761) [`39a88b3`](https://github.com/tktcorporation/vrchat-albums/commit/39a88b3a499126d55c5b681aa746dd3b3e2cb854) Thanks [@tktcorporation](https://github.com/tktcorporation)! - セキュリティ修正: electron, electron-builder, tar 等の依存パッケージを更新し、23 件の脆弱性を 1 件(low)に削減。サプライチェーン攻撃対策として .npmrc に min-released-date=3d を追加。

## 0.28.1

### Patch Changes

- [#758](https://github.com/tktcorporation/vrchat-albums/pull/758) [`b0fcb81`](https://github.com/tktcorporation/vrchat-albums/commit/b0fcb8193c35ce672aa57c43981f782ae9098c18) Thanks [@tktcorporation](https://github.com/tktcorporation)! - セキュリティ強化: 脆弱な依存パッケージのオーバーライド追加、ts-prune 削除、.npmrc 設定追加

## 0.28.0

### Minor Changes

- [#751](https://github.com/tktcorporation/vrchat-albums/pull/751) [`de1efd7`](https://github.com/tktcorporation/vrchat-albums/commit/de1efd74119d465d0e2cfb8db3b0a0caa5623e68) Thanks [@tktcorporation](https://github.com/tktcorporation)! - World Join 画像に EXIF メタデータ（サムネイル、撮影日時、説明）を埋め込む機能を追加

- [#736](https://github.com/tktcorporation/vrchat-albums/pull/736) [`ac7393e`](https://github.com/tktcorporation/vrchat-albums/commit/ac7393e2436bd03462439d83f5c8d4c410f23f95) Thanks [@tktcorporation](https://github.com/tktcorporation)! - Effect TS エラーハンドリング改善: try-catch を Effect パターンに変換し、no-try-catch lint ルールを追加

- [#734](https://github.com/tktcorporation/vrchat-albums/pull/734) [`d302147`](https://github.com/tktcorporation/vrchat-albums/commit/d30214741353f5a7d2ff32ad04e1d98673bcb182) Thanks [@tktcorporation](https://github.com/tktcorporation)! - neverthrow を Effect TS に全面移行。サービス層・コントローラー層・テストの全 73 ファイルを Effect パターンに変換し、型安全なエラーハンドリングと遅延評価の恩恵を得られるようにした。

- [#756](https://github.com/tktcorporation/vrchat-albums/pull/756) [`6e43ffb`](https://github.com/tktcorporation/vrchat-albums/commit/6e43ffbe96a680e66c9067c23401165a34d43c61) Thanks [@tktcorporation](https://github.com/tktcorporation)! - oxlint の style/pedantic カテゴリを有効化し、より厳格な lint 設定に移行

- [#731](https://github.com/tktcorporation/vrchat-albums/pull/731) [`3a38917`](https://github.com/tktcorporation/vrchat-albums/commit/3a389171ba14a7808856b07b9ee8cce144c31a38) Thanks [@tktcorporation](https://github.com/tktcorporation)! - World Join 画像自動生成機能を追加。ワールド参加時にワールド情報とプレイヤー一覧を含む画像を自動生成し、VRChat 写真フォルダに保存します。resvg-js による画像生成パイプラインの統一も含みます。

### Patch Changes

- [#749](https://github.com/tktcorporation/vrchat-albums/pull/749) [`2e2e511`](https://github.com/tktcorporation/vrchat-albums/commit/2e2e511c6274f6821e6ec9ee8d9320d95897ad58) Thanks [@tktcorporation](https://github.com/tktcorporation)! - Electron モジュールの遅延取得ヘルパーを集約し、リンタールールを追加

- [#757](https://github.com/tktcorporation/vrchat-albums/pull/757) [`106bf48`](https://github.com/tktcorporation/vrchat-albums/commit/106bf484b6ccefa3428d5ff40e96e50258bb2967) Thanks [@tktcorporation](https://github.com/tktcorporation)! - oxlint の重要なルールを厳格化: no-floating-promises と no-misused-promises を error に昇格し、新たに react/no-array-index-key, jsdoc/check-tag-names, jsx-a11y/no-static-element-interactions, no-anonymous-default-export を warn で有効化

- [#754](https://github.com/tktcorporation/vrchat-albums/pull/754) [`b8a9b0d`](https://github.com/tktcorporation/vrchat-albums/commit/b8a9b0db3f8cc8cc57679c47541c395ed4817a4b) Thanks [@tktcorporation](https://github.com/tktcorporation)! - World Join 画像の EXIF 書き込み失敗を修正。JPEG バッファに対して .png 拡張子の一時ファイルを使用していたため exiftool がフォーマット不一致エラーを返していた問題を、マジックバイトから拡張子を自動判定するように修正。

- [#748](https://github.com/tktcorporation/vrchat-albums/pull/748) [`a810f30`](https://github.com/tktcorporation/vrchat-albums/commit/a810f3012d3abe72de0bf17b2330d513726b4485) Thanks [@tktcorporation](https://github.com/tktcorporation)! - fix: PR [#744](https://github.com/tktcorporation/vrchat-albums/issues/744) (oxlint 移行) で巻き戻った logSync の修正を再適用

  - [#742](https://github.com/tktcorporation/vrchat-albums/issues/742): World Join 画像生成で写真ディレクトリのデフォルトフォールバックを復元
  - [#738](https://github.com/tktcorporation/vrchat-albums/issues/738): INCREMENTAL モードでの preLoadedLogLines 最適化を復元

- [#752](https://github.com/tktcorporation/vrchat-albums/pull/752) [`9322492`](https://github.com/tktcorporation/vrchat-albums/commit/9322492e318b873ae6b5294aab2938ee114d6cad) Thanks [@tktcorporation](https://github.com/tktcorporation)! - CHANGELOG.md を oxfmt の ignorePatterns に追加し、changeset-release ワークフローの失敗を修正

- [#755](https://github.com/tktcorporation/vrchat-albums/pull/755) [`a3769c8`](https://github.com/tktcorporation/vrchat-albums/commit/a3769c81b9c56f874056892c7082ac2624d075e0) Thanks [@tktcorporation](https://github.com/tktcorporation)! - Fix all 167 oxlint warnings across 57 files (no-shadow, no-nested-ternary, consistent-function-scoping, no-floating-promises, no-misused-promises, unbound-method, no-unsafe-\*)

- [#741](https://github.com/tktcorporation/vrchat-albums/pull/741) [`94c7ca2`](https://github.com/tktcorporation/vrchat-albums/commit/94c7ca2c446cd1be5f136d126f6ab7aa6273a600) Thanks [@tktcorporation](https://github.com/tktcorporation)! - getSessionInfoBatchEffect のエラー型を never に修正し、tRPC 側の不要な mapError を削除

- [#745](https://github.com/tktcorporation/vrchat-albums/pull/745) [`e50ff87`](https://github.com/tktcorporation/vrchat-albums/commit/e50ff87625c29759f9a82d26cdafec94f557983e) Thanks [@tktcorporation](https://github.com/tktcorporation)! - World Join 画像ダウンロード時に User-Agent ヘッダーを追加し、VRChat CDN からの取得失敗を修正

- [#742](https://github.com/tktcorporation/vrchat-albums/pull/742) [`0a064bd`](https://github.com/tktcorporation/vrchat-albums/commit/0a064bdf091397d6214c60dd53cfdad0dae6bd8f) Thanks [@tktcorporation](https://github.com/tktcorporation)! - World Join 画像生成で写真ディレクトリ未設定時にデフォルトパスへのフォールバックが効かないバグを修正

- [#750](https://github.com/tktcorporation/vrchat-albums/pull/750) [`44cd063`](https://github.com/tktcorporation/vrchat-albums/commit/44cd0631d173fab6e11b5dd6e919208665032011) Thanks [@tktcorporation](https://github.com/tktcorporation)! - push 前の検証を強制する hookify ルールを追加

- [#744](https://github.com/tktcorporation/vrchat-albums/pull/744) [`64dfe3d`](https://github.com/tktcorporation/vrchat-albums/commit/64dfe3d34676bcce54f558d4e261d36c071a8fbb) Thanks [@tktcorporation](https://github.com/tktcorporation)! - Biome から oxlint + oxfmt へ移行

- [#738](https://github.com/tktcorporation/vrchat-albums/pull/738) [`f798b1f`](https://github.com/tktcorporation/vrchat-albums/commit/f798b1f132c19efab765f2bd5f36605a7644e306) Thanks [@tktcorporation](https://github.com/tktcorporation)! - ログ同期の起動時パフォーマンスを最適化: 重複判定キャッシュ導入、ホットパスの Zod オーバーヘッド除去、INCREMENTAL モードでのファイル二重読み込み回避

- [#743](https://github.com/tktcorporation/vrchat-albums/pull/743) [`401d494`](https://github.com/tktcorporation/vrchat-albums/commit/401d4942b211d58ae393c3b6d697917c14492741) Thanks [@tktcorporation](https://github.com/tktcorporation)! - 未知の [Behaviour] ログパターン検出を専用モジュールへ分離し、重複集約により不要な Sentry ノイズを削減

- [#747](https://github.com/tktcorporation/vrchat-albums/pull/747) [`f70aec8`](https://github.com/tktcorporation/vrchat-albums/commit/f70aec89c7c9513cb65a55d13980be6c0d644904) Thanks [@tktcorporation](https://github.com/tktcorporation)! - oxlint ルールの強化: 移行時にオフにされたルールを再有効化し、堅牢性に寄与するルールを error に昇格

- [#737](https://github.com/tktcorporation/vrchat-albums/pull/737) [`77edd71`](https://github.com/tktcorporation/vrchat-albums/commit/77edd71d5a263ba4512d74d2dba9bf0c4ca41e1c) Thanks [@tktcorporation](https://github.com/tktcorporation)! - knip で検出された未使用コードを削除し、CI でエラーとして検出するように変更

## 0.27.0

### Minor Changes

- [#727](https://github.com/tktcorporation/vrchat-albums/pull/727) [`31062b1`](https://github.com/tktcorporation/vrchat-albums/commit/31062b16510f63eae4ab9557473f22874c18fa8c) Thanks [@tktcorporation](https://github.com/tktcorporation)! - logger.warnWithSentry() を追加し、警告レベルのイベントを Sentry に送信可能に。重要な 8 箇所の warn を移行

### Patch Changes

- [#725](https://github.com/tktcorporation/vrchat-albums/pull/725) [`32c7e01`](https://github.com/tktcorporation/vrchat-albums/commit/32c7e0195cfebecce78df9cdfac5a8f31a027ae6) Thanks [@tktcorporation](https://github.com/tktcorporation)! - 写真ファイルが削除・移動された場合の ENOENT エラーを予期されたエラーとして処理し、Sentry への不要な送信を防止

- [#726](https://github.com/tktcorporation/vrchat-albums/pull/726) [`372eff2`](https://github.com/tktcorporation/vrchat-albums/commit/372eff234828bd9f37056dfee35075457ed03d6a) Thanks [@tktcorporation](https://github.com/tktcorporation)! - ワールド参加ログのパーサーが不正なインスタンス ID でクラッシュする問題を修正し、アプリ起動失敗を防止

- [#730](https://github.com/tktcorporation/vrchat-albums/pull/730) [`cdb8a0c`](https://github.com/tktcorporation/vrchat-albums/commit/cdb8a0c5d4222403e4c1e868dc126c179e4d8051) Thanks [@tktcorporation](https://github.com/tktcorporation)! - GitHub Release Notes の生成を git-cliff から CHANGELOG.md（changesets 管理）ベースに統一

## 0.26.0

### Minor Changes

- [#717](https://github.com/tktcorporation/vrchat-albums/pull/717) [`ab3f0c8`](https://github.com/tktcorporation/vrchat-albums/commit/ab3f0c8af5f5db464b2680f45af01132a584a65d) Thanks [@tktcorporation](https://github.com/tktcorporation)! - Changeset によるリリース自動化の導入

- [#722](https://github.com/tktcorporation/vrchat-albums/pull/722) [`47bd9a8`](https://github.com/tktcorporation/vrchat-albums/commit/47bd9a8452b674143f270ae5bb4c2eaf6428e865) Thanks [@tktcorporation](https://github.com/tktcorporation)! - Replace sharp (C++/libvips) with @napi-rs/image (Rust-based) for image processing

- [#721](https://github.com/tktcorporation/vrchat-albums/pull/721) [`e89edbd`](https://github.com/tktcorporation/vrchat-albums/commit/e89edbd09010ee7e328f4897109e2cdbc00567a4) Thanks [@tktcorporation](https://github.com/tktcorporation)! - VRChat 公式 XMP メタデータ（2025.3.1 以降）のパース・保存機能を追加。写真インデックス作成時に撮影者・ワールド情報を自動抽出し DB に保存する。

## [unreleased]

### 🐛 Bug Fixes

- @getgrit/cli を削除し、制限環境でのビルド失敗を修正 (#679)
- UsePhotoGallery の不要な再レンダリングを削減 (#676) (#682)
- VRChat World Instance ID の UUID 形式をサポート (#686)

### 🎨 Styling

- Improve light mode design with cleaner, modern look (#678)

### ⚙️ Miscellaneous Tasks

- Add knip workflow to detect unused code on PRs (#677)
- Knip による未使用コードの整理 (#680)

## [0.25.0] - 2026-01-02

### 🐛 Bug Fixes

- ValidWidth 型で起動時のギャラリー幅 0 問題を根本修正 (#667)
- UseContainerWidth を Callback Ref パターンに変更 (#668)
- 写真一覧の無限ロード問題を修正 (#670) (#671)
- Ensure GritQL CLI works in restricted network environments (#672)
- Electron-is-dev を削除して app.isPackaged に置き換え (#674)

### ⚙️ Miscellaneous Tasks

- Upgrade dependencies and add Node.js version check (#669)
- Upgrade Yarn from 4.1.0 to 4.12.0 (#673)
- Release v0.25.0 (#675)

## [0.24.0] - 2025-12-31

### 🐛 Bug Fixes

- 起動時のフォトギャラリー幅初期化にリトライ機構を追加 (#663)
- Improve Playwright test stability in devcontainer (#664)

### 📚 Documentation

- Improve README structure with bilingual support (#665)

### ⚡ Performance

- Folder-hash から hash-wasm xxhash128 に置き換えてダイジェスト計算を高速化 (#662)

### ⚙️ Miscellaneous Tasks

- Bump version to 0.24.0 (#666)

### Debug

- 写真スキャン増分モード問題のデバッグログ追加 (#661)

## [0.23.0] - 2025-12-31

### 🚀 Features

- Redesign settings screen tab layout (#657)

### 🐛 Bug Fixes

- プレイヤーリストの初期状態をスケルトン表示に統一 (#654)
- Trpc-electron IPC バグによる巨大 toast 表示を抑制 (#655)

### 🚜 Refactor

- Neverthrow error handling patterns improvement (#656)
- デザインシステム刷新 - 8px グリッド・セマンティックトークン統一 (#658)
- 写真スキャン最適化 + Zod brand 型で型安全性向上 (#659)

### ⚙️ Miscellaneous Tasks

- Release v0.23.0 (#660)

## [0.22.0] - 2025-12-30

### 🚀 Features

- Add must-use-result check to neverthrow linter (#647)
- DateJumpSidebar に Google Photos/immich 風機能を追加 (#648)
- 設定画面のトンマナを統一 (#649)

### 🐛 Bug Fixes

- スクロール時のレイアウトシフトを改善 (#645)
- レイアウトシフト対策 - Immich 方式スケルトン実装とアニメーション削除 (#650)
- レイアウトシフト・上方向スクロール問題の解消と幅計算の一元化 (#651)
- 本番ビルドでグループ高さが統一される問題を修正

### ⚡ Performance

- メモリ使用量を最適化 (#646)

### ⚙️ Miscellaneous Tasks

- Release v0.22.0 (#653)

## [0.21.0] - 2025-12-23

### 🚀 Features

- Upgrade Tailwind CSS from v3 to v4 (#640)

## [0.20.0] - 2025-12-22

### 🚀 Features

- Claude Code v2 のベストプラクティスと linter システムの実装 (#617)
- 利用規約を Markdown 形式に変換しスタイル・内容を改善 (#619)
- Upgrade Electron to v39 for Node.js 22 compatibility (#632)

### 🐛 Bug Fixes

- Restrict platform display to Windows only in landing page (#590)
- プラットフォーム別アプリアイコンの自動生成システムを実装 (#597)
- 初回起動時以外でも「初期化中」と表示される問題を修正 (#610)
- GitHub Actions ワークフローの依存関係インストール処理を統一 (#612)
- Yarn workspace の依存関係インストール問題を修正 (#613)
- Yarn workspace の依存関係と Landing Page デプロイワークフローを修正 (#614)
- Grit CLI を devDependencies に追加して CI の lint エラーを修正 (#621)
- Tsx を devDependencies に追加して npx 依存を解消 (#622)

### ⚙️ Miscellaneous Tasks

- Remove unused icon files and update electron-builder configuration (#595)
- 開発環境設定の改善と MCP サーバー統合 (#596)
- ドキュメントの整理と XML 検証ツールの追加 (#600)
- 依存関係の包括的アップデートとバージョン管理改善 (#601)
- Update dependencies to latest minor and patch versions (#603)
- コンテナ環境での Electron 起動に--no-sandbox オプションを追加 (#604)
- Update landing page dependencies to latest patch versions (#605)
- Upgrade 12 major dependencies including React 19, tRPC v11, TanStack Query v5 (#606)
- Chrome DevTools MCP サーバーと開発環境の設定追加 (#615)
- 開発環境設定の改善 (#627)

## [0.19.0] - 2025-08-11

### 🚀 Features

- Improve instance type display with confidence-based detection (#558)
- Remove photo count display from LocationGroupHeader (#561)

### 🐛 Bug Fixes

- _(#549)_ LogLoad 中のエラーハンドリングを改善し、部分的な成功を許容 (#551)
- Replace wildcard pattern in sentry:sourcemaps script with explicit script names (#571)
- Improve light mode contrast by making foreground elements brighter (#574)
- Update LP image references to use playwright/previews images (#578)
- Automate landing page screenshot sync from playwright tests (#581)
- Automate landing page screenshot sync and UI improvements (#583)
- 右クリック写真コピーで全選択写真をコピーできない問題を修正 (#587)
- Screen イベントリスナーのクリーンアップ処理を追加 (#589)

### 🚜 Refactor

- Eliminate code duplication in logFileReader.ts (#560)

### 🎨 Styling

- Lighten glass-panel shadow for better visual weight (#567)

### ⚙️ Miscellaneous Tasks

- エラーハンドリングとプレイヤーアクションパーシングの堅牢性向上 (#565)
- Upgrade Zod to v4.0.5 (#573)
- Release v0.19.0 (#592)

## [0.18.0] - 2025-06-30

### 🚀 Features

- 写真選択 UI をモダンでシンプルなデザインに改善 (#497)
- ランディングページの実装と Tailwind CSS v4 への移行 (#532)
- VRChat Albums 紹介用ランディングページの実装 (#533)
- _(#529)_ ウィンドウヘッダーのダブルクリックで最大化/復元機能 (#537)

### 🐛 Bug Fixes

- 日付ジャンプサイドバーがアプリケーションヘッダーと重なる問題を修正 (#503)
- App tray の項目整理とアイコンクリック動作を追加 (#505)
- I18n の漏れを修正 (#502)
- フォトギャラリーのグループ間の余白を適切なサイズに調整 (#506)
- Primary color の不一致を修正 (#504)
- 入力要素のスタイル統一と SSH agent forwarding 設定 (#526) (#527)
- _(#476)_ UI コンポーネントの primary color 統一 (#535)
- ランディングページのビルドエラーを修正 (#543)

### 🚜 Refactor

- Replace if statements with ts-pattern in App.tsx (#514)
- Consolidate error helper functions to reduce duplication (#528)
- Apply ts-pattern to startup stage handling (#522)
- Phase 1 - Consolidate duplicate code patterns (#531)
- アイコンサイズの統一と定数化 (#542)
- _(#538)_ Transition duration の統一 (#540)
- TRPC エラーハンドリング、Sentry フィルタリング、利用規約改善 (#501)

## [0.17.0] - 2025-06-22

### 🚀 Features

- 写真クリック時に OS の標準写真ビューアーで開くように変更 (#475)
- 写真コピー機能を画像データコピーからファイルパスコピーに変更 (#481)
- 旧アプリからのデータ移行機能を再実装（Playwright テスト対応版） (#463) (#488)
- 写真ギャラリーに日付ジャンプサイドバーを実装 (#489)
- 写真ギャラリーに日付ジャンプサイドバー機能を実装 (#495)

### 🚜 Refactor

- ログファイルパス取得とフォトインデックス処理を最適化 (#480)

### ⚡ Performance

- プレーヤー名表示の遅延を大幅改善 (#483)
- ログファイル読み込みのパフォーマンスとスケーラビリティを大幅改善 (#486)

## [0.16.0] - 2025-06-18

### 🚀 Features

- 検索候補選択時の検索タイプ明示的指定機能を追加 (#458)
- 旧アプリからのデータ移行機能を実装 (#463)
- ローディングアニメーションを追加 (#466)
- 初回起動時の自動起動設定をデフォルト True に変更 (#467)

### 🐛 Bug Fixes

- PlayerName 検索のパフォーマンス最適化 (#457)
- ワールドリンクの URL 構造を修正 (#460)

## [0.15.0] - 2025-06-16

### 🚀 Features

- Add player name search (#415)
- Add frequently played players to search overlay (#416)
- DB→logStore 逆変換機能とエクスポート機能の実装 (#440) (#441)
- エクスポート先に日時付きサブフォルダを作成 (#442)
- Improve export functionality with default full-period mode and timezone handling (#446)
- バックアップエクスポート、インポート機能の実装 (#449)

### 🐛 Bug Fixes

- Add missing SENTRY_RELEASE environment variable in GitHub Actions (#418)
- Resolve initial startup database table error (#420)
- Show world headers even when no photos exist in sessions (#423) (#426)
- Implement comprehensive timeout prevention for getPlayerListInSameWorld queries (#431)
- Improve timeout error stack traces and debugging for cache operations (#433)
- 検索オーバーレイの UX 改善 (#434)
- Optimize session batch processing with PhotoAsLog integration and timeout improvements (#435)
- Improve cache key strategy for session player lists to prevent data integrity issues (#436)
- Remove session duration limits and optimize query performance (#437)
- AppendLoglinesToFile now properly appends instead of overwriting (#439)
- Resolve session boundary issues in player grouping for search (#452)

### 🚜 Refactor

- Simplify and reorganize CLAUDE.md for better readability (#419)
- Optimize DBQueue and add efficient session query batching (#432)
- Improve error handling with structured error info and user-friendly toast notifications (#448)

### 📚 Documentation

- Update README with current features and improved user guide (#451)

### 🧪 Testing

- ValueObject の型安全性向上とテスト修正 (#450)

### ⚙️ Miscellaneous Tasks

- Fix Sentry release config for sourcemaps (#413)
- Optimize LocationGroupHeader queries to prevent timeout errors (#427) (#428)

## [0.14.0] - 2025-06-10

### 🚀 Features

- Remember window size and position (#376)
- Local 開発で Sentry が dev で送られるように (#384)
- 原因不明エラーのトレースを調査しやすくする (#387)
- グラスモーフィズムスタイルの追加とアニメーションの強化 (#392)
- 写真の右クリックメニューからシェア機能を削除 (#401)

### 🐛 Bug Fixes

- ログ情報のロード設定を修正し、過去のログも含めるように変更 (#373)
- Log 保存時のバリデーション調整、photoAsLog との動作調整 (#383)
- LocationGroupHeader でセッション内全プレイヤーが表示されない問題を修正 (#396)
- LocationGroupHeader で rejoin したプレイヤーの重複表示を防止 + docs 更新 (#397)
- LocationGroupHeader と PhotoGrid の横幅整列問題を修正 (#398)

### 🚜 Refactor

- ログの更新処理をまとめる (#379)
- LocationGroupHeader.tsx を単一責任原則に従って分割 (#380)
- VRChat ログサービスを分割リファクタ (#381)
- AppHeader を統合して UI 一貫性を改善し、ボタンサイズを最適化 (#399)

### ⚙️ Miscellaneous Tasks

- Updates tests to cover the new photo directory functionality (#382)
- Pr-issue-link.yml の branch-prefix を修正 (#391)
- ワールドセッション管理機能をリファクタ (#394)

## [0.13.0] - 2025-06-01

### ⚙️ Miscellaneous Tasks

- Cleans up unused exports, standardizes logging, and refactors database queue usage across the Electron modules (#360)
- Update playwright test (#361)
- ローディング状態管理のためのカスタムフックを追加し、関連コンポーネントを更新 (#364)
- 複数のスクリーンショットをコメントに添付できるようにする (#367)

## [0.12.1] - 2025-06-01

### 🚀 Features

- Sentry setup (#323)
- Embed screenshots in PR comments (#324)
- Sentry イベントの個人情報マスク処理を追加 (#351)

### 🐛 Bug Fixes

- Fix missing Sentry DSN in electron main build (#340)
- ResizeObserver loop errors and missing data-index attributes (#348)

### 📚 Documentation

- Add missing docstrings (#318)

### ⚙️ Miscellaneous Tasks

- Lint スクリプトの更新と@typescript/native-preview の追加 (#309) (#320)
- Fix Sentry IPC preload (#330)
- Fix license generation output paths (#328)
- Add Claude Code GitHub Workflow (#333)
- Claude.yml に allowedTools を追加し、使用可能なツールのリストを更新 (#338)
- Fix workflow tool key and revert licenses (#344)
- Issue-link to match numeric branches (#346)
- Electron-pan-clip から clip-filepaths への移行と依存関係の更新 (#347)
- Lint 時に actionlint を実行 (#349)

## [0.12.0] - 2025-04-29

### 🚀 Features

- Log 処理を全件ではなく新しい分だけ処理することができるようにする WIP (#302)
- 複数写真のコピー機能を実装 (#306)

### 🐛 Bug Fixes

- 同じワールドにいたプレイヤーのリスト取得ロジックを修正 (#289)
- 通常ロードでは旧形式のログファイルは対象としない (#298)
- VRChat の写真パスインデックス作成処理を改善し、旧形式のログファイルを除外 (#299)
- Refresh 時に新しいログ分のデータが更新されない問題を修正 (#301)

### ⚙️ Miscellaneous Tasks

- ログファイルを分割して保存するようにする (#296)
- Log load 処理に時間がかかる原因を探るためのデバッグ行追加 (#297)
- 写真をセッションにグループ化するロジックを改善 (#300)

## [0.11.1] - 2025-03-05

### 🐛 Bug Fixes

- Sequelize モデルにテーブル名を明示的に指定 (#286)

## [0.10.3] - 2025-03-05

### 🚜 Refactor

- ロケーショングループヘッダーの UI を変更 (#278)
- Electron 設定を Vite ベースに移行し、モジュールタイプを更新 (#282)

### 🎨 Styling

- 背景色、スタイルの調整 (#281)

## [0.10.2] - 2025-02-23

### ⚙️ Miscellaneous Tasks

- Bump version to 0.10.2 and update log parsing regex (#276)

## [0.10.1] - 2025-02-04

### 🐛 Bug Fixes

- Sync 処理とグルーピング処理のローディングを別々に処理 (#272)

## [0.10.0] - 2025-02-04

### 🚀 Features

- 新しいロゴを追加 (#263)

### 🚜 Refactor

- テキストサイズ、余白調整、スケルトン表示 (#270)

## [0.9.0] - 2025-02-02

### 🚀 Features

- 最後に開いた写真をマークしてわかりやすくする (#257)

### 🚜 Refactor

- ヘッダー部分の余白,デザイン調整 (#255)
- 表示場所を調整してヘッダー領域の行数を減らす (#256)

## [0.8.0] - 2025-02-01

### 🚀 Features

- シェア画像のスタイルを変更 (#253)

## [0.7.0] - 2025-01-27

### 🚀 Features

- シェア画像のファイル名の形式を photoLog の形式に変更 (#244)
- Auto-update 機能の実装 (#246)

## [0.6.1] - 2025-01-25

### 🐛 Bug Fixes

- PlayerJoinLog にうまく usrId を記録できていなかった問題を修正 (#242)

## [0.6.0] - 2025-01-25

### 🚀 Features

- 個別の写真からシェア用の画像を生成できるように (#214)
- 追加の写真フォルダ読み込み対象を設定できるようにする (#215)
- 個別シェア画像のダウンロードを可能にする(暫定) (#222)
- 見つからなかった写真データはモデルから削除する (#224)
- プレイヤーの退出記録を保存する (#234)
- セットアップ時にエラーが出た場合の導線を設定 (#236)

### 🐛 Bug Fixes

- Path の処理を win/linux 互換にする (#219)

## [0.5.0] - 2025-01-14

### 🚀 Features

- シェア用の World Join プレビューを追加 (#201)
- プレビュー表示でプレイヤー名全量を表示するオプション追加 (#202)
- プレーヤーリストのクリップボードへのコピー機能を追加 (#205)

### 🐛 Bug Fixes

- 写真から取得じたログと通常ログの重複を想定 (#195)

## [0.4.0-alpha.2] - 2025-01-11

### 🚀 Features

- 初期ロードでのブロッキングを最低限にする (#192)

## [0.4.0-alpha.1] - 2025-01-10

### 🚀 Features

- Context-menu で写真の操作を行えるようにする (#176)
- Photo 表示の効率化 (#178)

### 🐛 Bug Fixes

- グルーピング処理を改善 (#179)

## [0.3.0-alpha.1] - 2025-01-05

### 🚀 Features

- Add button to manually apply updates (#131)
- Migrate は window が作成されてからにする (#135)
- データベース同期のエラーハンドリングを強化 (#143)
- 開発者ツールを常時表示に変更し、データベース同期エラーの調査を容易に (#144)
- LocationGroupHeader にプレイヤー情報表示を実装 (#147)
- 設定画面に app ログを開くためのボタンを追加 (#148)
- LocationGroupHeader のクエリ発行を画面内に入るまで遅延させる (#149)
- Sentry 導入のための設定 (#152)
- Photo のグルーピング処理を徐々に行うように変更 (#154)
- 写真を撮っていない時でも Join 記録を表示するように (#164)
- 写真を撮っていない join 記録を表示するかの切り替えフィルタを実装 (#165)
- ワールド Join のグルーピング処理を調整 (#166)
- 利用規約の同意をせずにアプリケーションを利用できないようにする (#167)
- ワールドリンクを外部リンクで開けるように (#170)
- ワールド名での検索機能実装 (#172)

### 🐛 Bug Fixes

- 本番でエラーが出たので devtools 削除

### 📚 Documentation

- Update changelog

### ⚙️ Miscellaneous Tasks

- Sentry の導入 (#151)

### Change

- ウィンドウ表示周りでバグがある可能性があるので処理を簡略化 (#137)
- ウィンドウ表示周りでバグがある可能性があるので処理を簡略化 (#138)

### Fest

- UI を中心に大幅に構成変更 (#132)
- Log.erro 時に sentry 呼び出し, bg 更新処理追加 (#153)

## [0.2.0-alpha.7] - 2024-11-10

### 🚀 Features

- ログの記録方法変更. ログファイルを簡単に開けるようにする (#127)
- アップデート処理の修正 (#128)

## [0.2.0-alpha.6] - 2024-11-10

### 🚀 Features

- アップデート機能の調整 (#125)

## [0.2.0-alpha.5] - 2024-10-21

### 🚀 Features

- 自動アップデートの仮実装 (#119)
- 写真サイズの拡大縮小機能 WIP (#121)

### 🚜 Refactor

- Use UUIDv7 for primarykey (#120)

### 📚 Documentation

- Update CHANGELOG.md (#111)

### ⚙️ Miscellaneous Tasks

- Use `create-pull-request@v7` to update CHANGELOG.md (#107)
- Changelog 更新に必要な権限を追加 (#108)
- Update changelog action (#110)
- AppVersion の取得方法変更 (#112)
- Use `ni` instead of `nci` (#117)

### Build

- `skipLibCheck`, `esModuleInterop` (#116)
- `yarn` の使用に戻す (#118)

### Release

- `v0.2.0-alpha.5` (#122)

## [0.2.0-alpha.4] - 2024-09-21

### ⚙️ Miscellaneous Tasks

- Fix github actions (#105)
- Fix update a changelog action (#106)

## [0.2.0-alpha.3] - 2024-09-21

### ⚙️ Miscellaneous Tasks

- CHANGELOG.md, upload draft artifacts (#98)
- Use bash shell (#99)
- Fix uploader (#100)
- Changelog settings (#101)
- Exe ファイルが gh release できない (#102)

### Release

- V0.2.0-alpha.3 (#103)

## [0.2.0-alpha.2] - 2024-09-21

### 🐛 Bug Fixes

- .github/workflows/upload-build-files.yml
- Upload-build-files.yml
- Upload-build-files.yml

### ⚙️ Miscellaneous Tasks

- Update build processes
- `changelog.md` を生成するように (#90)
- Changelog の ci 設定修正 (#91)
- Release ci の修正 (#92)
- バージョンが上がったら `v*` を push (#93)
- `v*` の tag push (#94)
- 修正 (#95)
- 修正 (#96)
- 修正 (#97)

### Build

- Release ビルドの方法を変更

## [0.2.0-alpha.1] - 2024-09-15

### 🚀 Features

- 月ごとに仕分けしてファイル生成できるように
- デザイン整備, refactor
- AppBar title to VRC Photo Tag
- 生成前に dialog で確認させる
- Join 情報を画面上に出す準備
- Add exif metadata to OGP image creation
- Refactor SideBar and PhotoList components
- Add navigation links and update sidebar layout
- CreateOGPImage add join date to image
- ScrollArea component to PhotoList sidebar
- Add error logging with electron-log
- Update AppBar styling
- Update routes and navigation components
- オンボでファイル作成のプレビューを出せるように
- Add error handling for uncaught exceptions
- 写真をグルーピングして表示するプレビューを実装
- Trpc error が発生した場合にエラーが記録されるようにする
- 作成、プレビューする画像のサイズを可変に
- 写真一覧画面でのエラーハンドリング強化
- 作成画面の UX 改善
- HOME を変更
- エラーハンドリング強化
- Error を使ってエラー追跡できるように
- エラーハンドリングの強化
- App log を直接開くボタンを設置
- Phpto click で写真を開く
- Service に同一 world への join を記録しないオプションを追加
- 重複削除のフラグを store から取得するように
- ワールド名の表示機能
- PhotoList で world 名表示
- Join log と photo をまとめて表示する
- ワールド名をリンク化
- 細かいスタイル修正
- バックグラウンド処理を有効化
- リンクホバーで underline
- Http or https のリンクをクリックしたときにデフォルトブラウザで開く
- Background 作成用の処理を書くための TODO コメント
- リンククリックでデフォルトブラウザを開く
- バックグラウンド設定用のボタンとページを追加
- バックグラウンド設定ページの UI 実装
- バックグラウンド処理切り替え UI の中身実装
- ファイルが既に存在していたら作成しない
- バックグラウンドで join log 作成処理
- ファイル作成ページと JoinList ページを統合
- Use noto sans jp as default font
- Add a sr-only guide
- Change app icon
- バックグラウンド処理が複数は知らないようにしたい
- アプリ名変更
- 状態の持ち方を整備
- ファイル作成後にリロードする
- UI デザイン修正
- 画面内に入った時にロード処理を行う
- JoinList の UI アップデート
- Toast でのエラーメッセージ表示を詳細にする
- PC 起動時の autoStart 設定
- バージョン情報の表記を追加
- 使用ライブラリのライセンス情報を記載
- 設定画面の UI アップデート
- Join 情報がない場合も unknown として表示する
- Join List の並び順を降順に統一
- WorldJoin と playerJoin の抽出
- Log file への書き込み service 実装
- Migration reset の仕組みを作る
- Log の仮保存まで
- Player と world の join 情報ログに絞って取得する
- LoadIndex の controller 作成
- LoadIndex の処理を追加(うまく動いていない)
- JoinInfoLogList の表示 UI 実装
- 選択した写真の撮影 world を返す仮実装
- 写真を撮ったワールドの詳細情報を取得して表示
- Resetdb に確認ボタンを付ける(いらないかも)
- Sequelize で db 処理を記述 local 起動成功
- Db sync が必要かどうかを確認してから実行するように
- Player 情報を出す UI wip
- 初回起動時にのみマイグレーション処理
- デザイン調整
- 起動時に log の書き込みと index 読み込みを行う
- 起動時に未設定の項目があったら設定画面へ誘導する
- ワールド情報表示の mvp 制作 wip
- (wip) sheet で settings を開く
- Update the app design [wip]
- Scroll いい感じ wip
- Fontsize 調整
- 葉にないだけスクロールするように
- 設定画面のスタイル微調整
- 色味 wip
- 選択した photo の情報を url に保持
- 写真一覧の取得と表示、その他 UI 調整
- 同じ join 内で撮影した写真も表示
- 写真が描画範囲に入ったときだけロードする
- Virtual scroll を使う
- 写真リストの UI 改善
- 写真リストの UI 改善
- ダミー写真ファイルの生成ロジック変更
- 写真の描画を改善
- 写真一覧 ui 改善
- 写真領域の縦幅を調整, 写真が存在しないときの hook を仮作成
- Validate not found vrcPhotoPath
- バーチャルスクロールの動きを直す
- バーチャルスクロール微調整
- Virtualscroll の縦幅を可変、日付を入れる
- Join 記録の表示を追加
- ワールド名表示の UI 調整
- グルーピング修正
- Shadcn-ui@latest add context-menu
- 写真のコピー機能実装

### 🐛 Bug Fixes

- Lint
- Type-check errors
- Ci permission errors
- Build ci
- Add permissions
- Release processes
- Release ci
- Release ci
- Release ci
- Release ci
- Release process
- Release ci
- Release ci
- Release
- Whiteout renderer
- Release ci
- Typo
- Release ci
- Ci
- Revert
- Ci
- Ci
- VRChat log and photo directory default
- Handle new month photo dir log
- Buildsettings
- Fix font file path in infoFile/lib.ts
- サムネイル画像の timezone を正す
- Lint command
- Date 変換の修正とさらなる logging
- Timezone
- Logfile が長い場合に Maximum call stack size exceeded. が起こる問題を修正
- レンダリングループ
- Failed tests
- Failed tests
- 同じ写真が出てくる問題を key を変更して解決できるかどうか
- PhotoList は上の方が新しい物が来る
- PhotoList の key を unique にする
- Key 指定の間違いを修正
- 表示のタイムゾーンを修正
- Fix setup script
- Yarn lint:fix
- Use yarn v4
- Playwrite test
- Playwrite test
- Playwrite test
- Playwrite test
- Playwrite test
- Playwrite test
- Playwrite
- Playwrite
- Playwrite
- Fix typo [playerite -> playwright]
- バックグラウンドプロセスの動きを修正
- `Object has been destroyed` の抑止
- 無限レンダリングを抑制
- 初期表示時の状態の持ち方を改善
- バックグラウンドファイル作成時に数が実態より多く出ていた問題
- New Join List の並びを日時の降順
- 何故か描画時に switch が切り替わるが、整合性はとれるように
- 複数バックグラウンドプロセスが立ち上がらないようにしたい
- ウィンドウを開く度に tray が作成されていた問題を修正
- 並び順の修正
- Fix command
- App version を package.json から取得する
- バージョン情報を package.json から取得
- Build ci
- Fix erros
- Errors
- Errors
- Tests
- LoadIndex の処理を修正
- Prisma client を prod で使うための設定
- Build 設定を変えることでエラー解決を試みる
- Window を出す前に migrate を走らせない
- 起動時に migrate を走らせる
- Db path の組み立て方を変更
- Wondows の場合 file url は `file///` で始める
- 環境変数の渡し方を変更
- `node_modules/.bin/prisma` が存在するかを確認して実行
- コマンドの実行結果を UTF-8 エンコードして戻す
- エラーを utf8 で上げ直す
- Sjis の encode
- Encoding
- Debug
- Tsconfig の修正
- Test 修正
- Test 修正
- PackageJsonPath の取得方法変更
- AppVersion の取得方法を変更
- AppVersion の取得方法変更
- PlayerJoin の記録が行えるように修正
- プレイヤー情報を取得できるように
- Dirpath の validation を無効化
- JoinLog に重複があったときにエラーになるバグを修正
- 範囲内の写真だけ出てくるように

### 🚜 Refactor

- Some
- 型アップデート
- Remove unused code and dependencies.
- Use trpc to clear settings
- Use shadcn button
- VRChat photo directory path.
- Biome init and lint
- Lint:fix
- Composables でリファクタ
- SettingStore の呼び出し箇所を限定
- 使用する store を外部から差し込み可能に
- Router path の取得ができなかった場合に例外
- Package 構成変更
- Rename a func
- Refactor joinInfoLogFileRouter
- 不要関数の削除
- 処理をまとめる
- 関数移動
- Rm unused lines
- JoinList のコンポーネントを分割
- 使用されていない export をいくつか削除
- Module structure
- テストが落ちてしまったので応急措置
- RdbClient を singleton 化
- Move dirs
- 未使用ファイルの削除
- DbRest 時の logging 形式を変更
- 不要な prisma 関連を削除
- Use hooks
- Remove an useMemo
- Hooks の整理
- 描画調整
- Hooks の整理

### 📚 Documentation

- Update readme
- Update checkbox
- Update readme
- Update
- Add a note
- Note 更新
- Release にスクリーンショットを含めたい
- やることやりたいこと
- Unused export を怒りたい
- Fix lint error and add onboarding UI
- README の開発手順を update
- Update README
- Update README
- Screenshot
- Screenshot
- Update screenshots
- スクショ更新
- スクショ更新
- Update screenshots
- Update screenshots
- Readme に利用説明を追加
- Fix readme
- Update readme
- Delete readme

### ⚡ Performance

- 削除して問題なさそうな useMemo

### 🎨 Styling

- プレビューの回り込みとスクロール
- Navbar を固定
- 中央寄せ
- `function-declaration` -> `arrow-function`
- 戻る -> もどる
- Lint fix with biome
- Upgrade biome and lint files
- Fix format settings
- Remove unused lines

### 🧪 Testing

- 検証用
- 解読不能なテストを削除
- テストの修正
- Test 修正
- Playwrite の実行、スクショに成功
- Fix
- Fix tests
- Fix tests
- テスト修正

### ⚙️ Miscellaneous Tasks

- Change dir and more
- Add release workflows
- Update hooks
- Update ci
- .gitignore
- Github extension 追加
- Add screen shot ui
- 少し trpc に処理を移行
- Add GitHub Actions workflow for AI PR reviewer
- Use tRPC
- 何故か分からないが desktop-lite でも動くように
- Pre-commit hook to run lint without fixing
- Add VRChat debug photos to .gitignore
- Biome lint
- Biome lint
- Fix formatting issues in code
- Biome lint
- Update yarnm.lock
- Addtest to ci
- Precommit command の変更
- Update eslintrc
- Lint 実行の順番を変更
- CompilerOptions の変更
- デバッグ用にログ追加
- Gen sourcemap
- Debug log
- Error log
- Logging
- Logging trpc error
- Error handling update
- Npx shadcn-ui@latest add tooltip
- Add `@antfu/ni`
- パフォーマンス調査用
- Nodeversion の指定に package.json を使う
- デバッグ用のファイル生成はスクリプトで行う
- デバッグファイル削除用のコマンド
- Use bun
- Use antfu/ni
- Fix https://github.com/vitejs/vite/issues/15714
- Trust simple-git-hooks
- Use antfu/ni
- Use yarn v4
- Add vscode-conventional-commits
- Https://github.blog/2024-02-12-get-started-with-v4-of-github-actions-artifacts/
- Update vscode extensions
- Remove eslint settings
- Pr 作成時にスクショをコメントする
- Update plawwrite test
- Remove configs for eslint
- Pr issue linker
- `nr lint` で type-check も行う
- Update the issue link style
- Upgrade tailwindcss
- Upgrade electron-builder
- Rm `node-html-to-image`
- Ci でライセンスチェック
- V0.4.0
- Vx.x.x の tag が作られた時だけ正式リリース
- Update ci dependencies
- パッケージのバージョン固定, upgrade
- Github actions の ubuntu version を固定
- Logging の種類を info -> debug
- Logging 設定を変更
- Add shadcn drawer
- Production で debug log は流さない
- Update dependencies
- Debug 用 script の修正
- Bump version 0.2.0

### Add

- Log dir の選択と worldid, timestamp の取得、表示
- Error boundary の追加
- ファイルの存在チェック処理を追加

### Build

- ビルド結果に app version を含める
- _(deps)_ Bump ip from 2.0.0 to 2.0.1
- Set product name

### Change

- Refactor and move AppBar
- UI を少し整え
- World 名も取得する
- Refactor router paths and add constants file

### Clean

- Some fix
- Rm unused lines
- 使わなさそうなファイルの削除

### Debug

- Raw log

### Delete

- License

### Feeat

- 写真をグルーピングする処理を書いた(動いていなさそう)

### Fefactor

- 型 update

### Note

- Todo 記述

### Update

- Vrchat photo dir が正しく設定されているかチェック
- Iroiro
- Handle ENOENT

### Wip

- Setup project
- Setup electron
- Ugoitakamo?
- No styled shadcn button
