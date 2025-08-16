# VRChat Albums

<p align="center">
  <img src="./assets/icon.png" alt="VRChat Albums Logo" width="128" height="128">
</p>

<p align="center">
  <strong>VRChatの思い出を整理しよう</strong><br>
  VRChatで撮影した写真を自動的に整理し、ワールドやフレンドとの思い出を簡単に振り返ることができるデスクトップアプリケーション
</p>

<p align="center">
  <a href="https://github.com/tktcorporation/vrchat-albums/releases">
    <img src="https://img.shields.io/github/v/release/tktcorporation/vrchat-albums?label=latest%20release" alt="Latest Release">
  </a>
  <a href="https://github.com/tktcorporation/vrchat-albums/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/tktcorporation/vrchat-albums" alt="License">
  </a>
  <a href="https://github.com/tktcorporation/vrchat-albums/issues">
    <img src="https://img.shields.io/github/issues/tktcorporation/vrchat-albums" alt="Issues">
  </a>
</p>

![Screenshot](playwright/previews/VRChatAlbums-finalized.png)

## ✨ 特徴

- 📸 **自動整理** - VRChatのログファイルと写真を自動的に関連付け
- 🌍 **ワールド情報** - いつ、どのワールドで撮影したかを記録
- 👥 **フレンド管理** - 一緒にいたフレンドの情報も記録
- 💾 **バックアップ** - 大切な思い出を安全にエクスポート・インポート
- 🔍 **高速検索** - ワールド名、フレンド名で瞬時に検索
- 🎨 **直感的なUI** - ダークモード対応の操作しやすいなインターフェース

## 🖥️ 対応プラットフォーム

- Windows 10/11 (64-bit)

## 📋 主な機能

### 📸 写真管理
- **自動インポート** - VRChatの写真フォルダから自動的に写真を読み込み
- **スマート整理** - Joinごとに自動グループ化
- **高速サムネイル** - 大量の写真も快適に閲覧できる最適化されたサムネイル表示


### 💾 バックアップ機能
- **フルバックアップ** - すべてのデータを安全にエクスポート
- **簡単インポート** - 他のPCへの移行やデータ復元が簡単

### 🎨 カスタマイズ
- **テーマ切り替え** - ダークモード/ライトモード対応
- **言語設定** - 日本語/英語対応

## 🚀 インストール方法

### Windows

1. [最新のリリース](https://github.com/tktcorporation/vrchat-albums/releases/latest)から`VRChatAlbums-Setup-x.x.x.exe`をダウンロード
2. ダウンロードしたインストーラーを実行
3. インストールウィザードに従ってインストール
4. デスクトップまたはスタートメニューからVRChat Albumsを起動

### 初回セットアップ

1. **VRChat写真フォルダの設定**
   - 通常: `C:\Users\[ユーザー名]\Pictures\VRChat`
   - カスタムパスを使用している場合は設定画面で変更

2. **VRChatログフォルダの確認**
   - アプリが自動的に検出（通常は問題なし）
   - 必要に応じて設定画面で確認・変更

## 📖 使い方

### 基本的な使い方

1. **写真を見る**
   - メイン画面でサムネイルをクリックして詳細表示
   - バッチ操作 - 複数の写真を選択して一括コピー
2. **写真を探す**
   - 上部の検索バーでワールド名やフレンド名を入力

3. **データをバックアップ**
   - メニューから「エクスポート」を選択
   - 期間やワールドを指定（指定しない場合は全データ）
   - エクスポート先フォルダを選択して実行

## ❓ よくある質問

### Q: VRChatの写真が表示されません
**A:** 設定画面でVRChatの写真フォルダが正しく設定されているか確認してください。デフォルトは`C:\Users\[ユーザー名]\Pictures\VRChat`です。

### Q: ログファイルが見つかりませんというエラーが出ます
**A:** VRChatを一度も起動していない場合、ログファイルが存在しません。VRChatを起動してから再度お試しください。

### Q: データのバックアップはどこに保存されますか
**A:** エクスポート時に指定したフォルダに、日時付きのサブフォルダが作成されて保存されます。

## 🐛 トラブルシューティング

問題が発生した場合は、以下を試してください：

1. アプリを再起動する
2. 設定画面でフォルダパスを確認する
3. [Issues](https://github.com/tktcorporation/vrchat-albums/issues)で既知の問題を確認する

## 🛠️ 技術スタック

- **Electron**: クロスプラットフォームのデスクトップアプリケーションフレームワーク
- **React**: ユーザーインターフェース構築のための JavaScript ライブラリ
- **Vite**: 高速なフロントエンドビルドツール
- **tRPC**: 型安全な API 開発のためのフレームワーク
- **SQLite**: 軽量なローカルデータベース
- **Tailwind CSS**: ユーティリティファーストの CSS フレームワーク
- **Vitest**: Vite 上で動作するユニットテストフレームワーク

## 🤝 コントリビューション

バグ報告、機能提案、プルリクエストを歓迎します！
詳細は[CONTRIBUTING.md](CONTRIBUTING.md)をご覧ください。

### 開発に参加する

```bash
# リポジトリをクローン
git clone https://github.com/tktcorporation/vrchat-albums.git
cd vrchat-albums

# 依存関係をインストール
yarn install

# 開発サーバーを起動
yarn dev
```

## 📄 ライセンス

このプロジェクトは [MIT License](LICENSE) のもとで公開されています。

---

<p align="center">
  Made with ❤️ for VRChat Community
</p>
