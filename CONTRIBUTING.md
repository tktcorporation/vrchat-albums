# コントリビューションガイド

このプロジェクトへのコントリビューションを歓迎します！バグ報告、機能提案、プルリクエストなど、どのような形でも貢献いただけます。

## 開発環境セットアップ

**確認済み 開発環境:**

*   Ubuntu focal (GitHub Codespaces)
    *   [https://github.com/features/codespaces](https://github.com/features/codespaces)
    *   ref: [.devcontainer/devcontainer.json](.devcontainer/devcontainer.json)
        *   linux
        *   nodejs (Node.js 20 が必須です)

1.  **リポジトリのクローン**:
    ```bash
    git clone https://github.com/tktcorporation/vrchat-albums.git
    cd vrchat-albums
    ```

2.  **依存関係のインストール**:
    プロジェクトルートで以下のコマンドを実行し、必要なパッケージをインストールします。
    ```bash
    pnpm install
    ```
    プロジェクトでは `pnpm` (バージョン10+) を使用しています。特別な理由がない限り、`pnpm` コマンドを使用してください。

3.  **ネイティブモジュールのリビルド** (必要な場合):
    特定のネイティブモジュール（例: `clip-filepaths`）で問題が発生した場合は、以下のコマンドでリビルドを試みてください。
    ```bash
    pnpm rebuild-native
    ```

## 開発ワークフロー

1.  変更を加えます。
2.  `pnpm lint:fix` を実行して、フォーマットの問題を自動修正します。
3.  `pnpm lint` を実行して、残りのリンティングエラーや型エラーがないことを確認します。
4.  `pnpm test` を実行して、すべてのテストがパスすることを確認します。
5.  上記の手順がすべて成功した場合にのみ、プルリクエストを作成または更新してください。

コミット前には、 pre-commit フックによって `pnpm lint` が自動的に実行されます。
すべての変更は、マージされる前に CI チェックをパスする必要があります。

## 主要な開発コマンド

-   **開発モードでの起動**:
    レンダラープロセスとメインプロセスの両方を開発モードで起動し、ホットリロードを有効にします。
    ```bash
    pnpm dev
    ```
    **注意**: 現状、Electron のメインプロセス (background 側) のホットリロードは完全には機能しない場合があります。変更が反映されない場合は、手動で再起動してください。

-   **ビルド**:
    アプリケーションのプロダクションビルドを生成します。
    ```bash
    pnpm build
    ```

-   **リンティングとフォーマット**:
    コードの静的解析とフォーマットを実行します。
    ```bash
    # Biome を使用したチェック
    pnpm lint:biome
    # TypeScript の型チェック (tsc)
    pnpm lint:type-check:tsc 
    # TypeScript の型チェック (tsgo - より高速なRust製チェッカー)
    pnpm lint:type-check:tsgo
    # Actionlint による GitHub Actions ワークフローのチェック
    pnpm lint:actionlint

    # 上記すべてを実行
    pnpm lint 
    ```
    自動修正可能な問題を修正するには:
    ```bash
    nr lint:fix 
    ```
    または
    ```bash
    biome check --apply-unsafe .
    ```

-   **テスト**:
    ユニットテストおよびインテグレーションテストを実行します。
    ```bash
    pnpm test
    ```
    個別のテストスイートを実行することも可能です:
    ```bash
    pnpm test:web       # レンダラープロセスのテスト (Vitest)
    pnpm test:electron  # メインプロセスのテスト (Vitest)
    pnpm test:playwright # E2E テスト (Playwright)
    ```

-   **デバッグ用データの生成**:
    開発中に使用するデバッグ用の写真やログデータを生成します。
    ```bash
    pnpm generate:debug-data
    ```

-   **未使用コードの検出**:
    `ts-prune` を使用して、エクスポートされているが使用されていないコードを検出します。
    ```bash
    pnpm find-deadcode
    ```

-   **ライセンス情報の生成と確認**:
    プロジェクトで使用しているライブラリのライセンス情報を生成し、許可されていないライセンスがないか確認します。
    ```bash
    pnpm license-check:generate
    pnpm license-check:validate
    ```

## GitHub Codespaces での開発

このプロジェクトは GitHub Codespaces での開発をサポートしています。

-   **仮想デスクトップへのアクセス**:
    GitHub Codespaces を使用して開発する場合、通常デスクトップ環境にはアクセスできません。
    このプロジェクトでは、`DesktopLite` を使用して仮想デスクトップ環境にアクセスできるように設定されています。
    ブラウザで `localhost:6080?resize=scale` を開き、パスワード `vscode` を使用して仮想デスクトップにアクセスできます。これにより、Electron アプリケーションの GUI を確認しながら開発を進めることが可能です。

## コーディングスタイルと規約

-   プロジェクトでは [Biome](https://biomejs.dev/) を使用してコードのフォーマットとリンティングを行っています。コミット前に `pnpm lint:fix` を実行して、コードスタイルを統一してください。
    主要なルールは `biome.json` で設定されています。
-   TypeScript の strict モードが有効になっています。
-   Sequelize モデルでは TypeScript のデコレーターが使用されています。

## ブランチ戦略

-   `main`: 最新のリリースバージョンです。
-   `develop`: 次期リリースのための開発ブランチです。
-   フィーチャーブランチ: `feature/issue-number-description` (例: `feature/123-add-new-button`)
-   バグフィックスブランチ: `fix/issue-number-description` (例: `fix/456-fix-login-error`)

プルリクエストは `develop` ブランチに対して作成してください。

## Issue トラッキング

バグ報告や機能要望は GitHub Issues を使用してください。Issue を作成する際には、可能な限り詳細な情報を提供してください。

## プルリクエスト

1.  リポジトリをフォークし、ローカルにクローンします。
2.  新しいブランチを作成します (`git checkout -b feature/my-new-feature`)。
3.  変更をコミットします (`git commit -am 'Add some feature'`)。
4.  フォークしたリポジトリにプッシュします (`git push origin feature/my-new-feature`)。
5.  プルリクエストを作成します。

プルリクエストには、変更内容の概要と関連する Issue 番号を記載してください。

## リリースプロセス

このプロジェクトでは、以下の GitHub Actions ワークフローによってリリースプロセスの一部が自動化されています。

-   **自動タグ付け**: `main` ブランチへのプッシュ時に、`package.json` のバージョンに基づいたタグが自動的に作成されます。
    -   参照: [.github/workflows/tag-on-push.yml](.github/workflows/tag-on-push.yml)
-   **ビルドとリリース**: 新しいタグがプッシュされると、アプリケーションがビルドされ、GitHub Releases に成果物がアップロードされます。
    -   参照: [.github/workflows/upload-build-files.yml](.github/workflows/upload-build-files.yml)

詳細なリリース手順や手動での操作が必要な場合は、別途ドキュメントを参照してください。

## その他

不明な点があれば、Issue で気軽に質問してください。 
