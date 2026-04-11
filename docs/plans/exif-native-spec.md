# exif-native: Rust + napi-rs による EXIF/XMP ネイティブモジュール仕様書

## 概要

`exiftool-vendored`（Perl 子プロセス）を Rust + napi-rs のネイティブモジュールで置き換える。
monorepo 内パッケージ `packages/exif-native` として構成し、pnpm workspace 経由で参照する。

## 背景: なぜ exiftool-vendored が重いのか

| 問題                 | 詳細                                                         | 影響                                             |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| **Perl 子プロセス**  | exiftool は Perl 製。起動→stdin/stdout IPC のオーバーヘッド  | 毎回のプロセス間通信コスト                       |
| **一時ファイル経由** | バッファ操作は 一時ファイル作成→exiftool実行→読み戻し        | ディスクI/O 3回                                  |
| **ハング頻発**       | PNG で `-fast2` がハング。30s + 35s の二重タイムアウトが必要 | ユーザー体験の悪化、タイムアウト回復処理の複雑化 |
| **依存サイズ**       | Perl バイナリを vendored で同梱                              | Electron アプリサイズ増加                        |
| **シングルキュー**   | 1つの exiftool プロセスに全リクエストがキューイング          | 1ファイルのハングが後続全てをブロック            |

Rust ネイティブモジュールで解決できること:

- **インプロセス実行**: IPC なし、プロセス起動なし
- **バッファ直接操作**: 一時ファイル不要
- **ハングなし**: タイムアウト設計自体が不要になる
- **並列実行**: Rust 側でマルチスレッド対応可能

---

## スコープ

### 現在 exiftool-vendored が担っている機能

| 機能                       | 用途                                                       | 呼び出し頻度                   | 置き換え対象 |
| -------------------------- | ---------------------------------------------------------- | ------------------------------ | ------------ |
| **XMP 読み取り**           | VRChat メタデータ抽出 (AuthorID, WorldID 等)               | 高（数百〜数千ファイルバッチ） | ✅           |
| **EXIF 書き込み**          | World Join Image への日時・説明埋め込み                    | 低（画像生成時のみ）           | ✅           |
| **EXIF 全タグ読み取り**    | `readExif()` — 現在は XMP 読み取りのフォールバック的に使用 | 低                             | ✅           |
| **バッファ経由の読み書き** | `readExifByBuffer()`, `setExifToBuffer()`                  | 低                             | ✅           |

### 置き換え後の API サーフェス

```typescript
// packages/exif-native の公開 API

/** VRChat XMP メタデータ（読み取り結果） */
export interface VrcXmpMetadata {
  authorId: string | null;
  author: string | null;
  worldId: string | null;
  worldDisplayName: string | null;
}

/** EXIF 書き込み用パラメータ */
export interface ExifWriteParams {
  description: string;
  dateTimeOriginal: string; // "yyyy:MM:dd HH:mm:ss"
  timezoneOffset: string; // "+09:00"
}

// ── 読み取り ──

/** ファイルパスから VRChat XMP メタデータを読み取る */
export function readVrcXmp(filePath: string): VrcXmpMetadata | null;

/** バッファから VRChat XMP メタデータを読み取る */
export function readVrcXmpFromBuffer(buffer: Buffer): VrcXmpMetadata | null;

/** 複数ファイルから VRChat XMP メタデータをバッチ読み取り（Rust 側で並列化） */
export function readVrcXmpBatch(
  filePaths: string[],
): Array<VrcXmpMetadata | null>;

// ── 書き込み ──

/** ファイルに EXIF メタデータを書き込む（ファイルを直接変更） */
export function writeExif(filePath: string, params: ExifWriteParams): void;

/** バッファに EXIF メタデータを書き込んで新しいバッファを返す */
export function writeExifToBuffer(
  buffer: Buffer,
  params: ExifWriteParams,
): Buffer;

// ── ユーティリティ ──

/** バッファの先頭バイトから画像フォーマットを判定 */
export function detectImageFormat(buffer: Buffer): 'jpeg' | 'png' | 'unknown';
```

---

## Rust アーキテクチャ

### ライブラリ選定

| 役割                       | クレート               | 理由                                                     |
| -------------------------- | ---------------------- | -------------------------------------------------------- |
| **JPEG/PNG コンテナ操作**  | `img-parts`            | セグメント/チャンクの読み書き。バッファ完全対応          |
| **XMP 読み取り**           | `roxmltree`            | 純 Rust DOM パーサー。高速、C 依存なし                   |
| **XMP 書き込み**           | `quick-xml`            | SAX スタイル XML ライター。書き込み時のみ使用            |
| **EXIF 読み取り**          | 不要                   | このプロジェクトでは EXIF タグの読み取り不要（XMP のみ） |
| **EXIF 書き込み**          | 自前実装（~200行）     | 7 フィールドのみ。TIFF IFD 構造を直接組み立て            |
| **napi-rs バインディング** | `napi` + `napi-derive` | Node.js ↔ Rust ブリッジ                                  |

> **C/C++ 依存ゼロ**: 全て純 Rust クレートで構成。クロスコンパイルが容易。

### モジュール構成

```
packages/exif-native/
├── Cargo.toml
├── package.json
├── build.rs                    # napi-rs ビルドスクリプト
├── npm/                        # プラットフォーム別 optional dependencies（将来の npm 公開用）
├── src/
│   ├── lib.rs                  # napi-rs エントリポイント（#[napi] 関数定義）
│   ├── xmp/
│   │   ├── mod.rs
│   │   ├── reader.rs           # XMP 読み取り（PNG iTXt / JPEG APP1 から XML 抽出 → パース）
│   │   └── writer.rs           # XMP 書き込み（将来用、現時点では不要）
│   ├── exif/
│   │   ├── mod.rs
│   │   └── writer.rs           # EXIF IFD 構築 + img-parts でセグメント挿入
│   ├── container/
│   │   ├── mod.rs
│   │   ├── jpeg.rs             # JPEG APP1 セグメント操作
│   │   └── png.rs              # PNG iTXt / eXIf チャンク操作
│   └── detect.rs               # マジックバイト画像フォーマット検出
├── __test__/
│   └── index.spec.ts           # Node.js 側の統合テスト
└── tests/
    ├── fixtures/               # テスト用画像ファイル（VRChat XMP 付き PNG/JPEG）
    ├── xmp_read_test.rs
    └── exif_write_test.rs
```

### XMP 読み取りフロー

```
ファイル / バッファ
    │
    ├─ JPEG の場合:
    │   img-parts::jpeg::Jpeg::from_bytes()
    │   → APP1 セグメントを走査
    │   → "http://ns.adobe.com/xap/1.0/\0" プレフィックスを持つものを抽出
    │   → XMP XML 文字列を取得
    │
    └─ PNG の場合:
        img-parts::png::Png::from_bytes()
        → iTXt チャンクを走査
        → keyword == "XML:com.adobe.xmp" のチャンクを抽出
        → XMP XML 文字列を取得

    │
    ▼
roxmltree::Document::parse(xmp_xml)
    │
    ▼
RDF/XML ツリーを走査:
    - rdf:Description ノードを探す
    - 以下の属性を抽出（実際の VRChat XMP 構造から確認済み）:
      - vrc:AuthorID (属性) → authorId
      - vrc:Author (属性) → authorDisplayName ※ dc:creator は RDF Seq で配列になるため属性を優先
      - vrc:WorldID (属性) → worldId
      - vrc:WorldDisplayName (属性) → worldDisplayName
    - CreatorTool == "VRChat" で VRChat 製写真であることを検証可能
    │
    ▼
VrcXmpMetadata を返す
```

### 実際の VRChat XMP 構造（2026-04 確認）

```xml
<rdf:Description rdf:about=""
  xmlns:vrc="http://ns.vrchat.com/vrc/1.0/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:xmp="http://ns.adobe.com/xap/1.0/"
  vrc:AuthorID="usr_3ba2a992-724c-4463-bc75-7e9f6674e8e0"
  vrc:Author="tkt_"
  vrc:WorldID="wrld_b7280487-a1bc-41e2-80f2-942a72e7d2c7"
  vrc:WorldDisplayName="Hanami Days 花見の日"
  xmp:CreatorTool="VRChat">
</rdf:Description>
```

**重要な発見:**

- `vrc:Author` は属性として格納される（exiftool は `Author: string` として返す）
- `dc:creator` は RDF Seq 要素として格納される（exiftool は `Creator: string[]` として返す）
- `resolveStringTag` は `typeof value === 'string'` でフィルタするため、配列の `Creator` はスキップされ `Author` が使われる

### EXIF 書き込みフロー

```
書き込みパラメータ (ExifWriteParams)
    │
    ▼
EXIF IFD バイト列を構築:
    1. TIFF ヘッダー ("Exif\0\0" + byte order mark "II" + magic 0x002A + offset)
    2. IFD0 エントリ:
       - 0x010E ImageDescription (ASCII)
    3. SubIFD (Exif IFD) エントリ:
       - 0x9003 DateTimeOriginal (ASCII, 20 bytes "yyyy:MM:dd HH:mm:ss\0")
       - 0x9004 DateTimeDigitized (ASCII, 20 bytes)
       - 0x9010 OffsetTime (ASCII)
       - 0x9011 OffsetTimeOriginal (ASCII)
       - 0x9012 OffsetTimeDigitized (ASCII)
    4. データ領域（文字列値を格納）
    │
    ▼
ファイル / バッファ
    │
    ├─ JPEG の場合:
    │   img-parts::jpeg::Jpeg::from_bytes()
    │   → 既存の APP1 (EXIF) セグメントがあれば置換、なければ挿入
    │   → Jpeg::encoder().bytes() で新しいバッファを生成
    │
    └─ PNG の場合:
        img-parts::png::Png::from_bytes()
        → eXIf チャンクとして挿入（PNG 1.5 spec 準拠）
        → Png::encoder().bytes() で新しいバッファを生成
```

### バッチ読み取り（readVrcXmpBatch）

```rust
// Rayon による並列処理（napi-rs の async は Node イベントループを使うため、
// CPU バウンドな I/O 処理は Rayon のスレッドプールで並列化する方が効率的）
use rayon::prelude::*;

#[napi]
pub fn read_vrc_xmp_batch(file_paths: Vec<String>) -> Vec<Option<VrcXmpMetadata>> {
    file_paths
        .par_iter()
        .map(|path| read_vrc_xmp_from_file(path).ok())
        .collect()
}
```

現状の exiftool-vendored は並列数 5〜20 で Promise.all バッチ処理 + 30s タイムアウト。
Rayon なら CPU コア数に自動スケール、タイムアウト不要。

---

## monorepo 統合

### pnpm-workspace.yaml

```yaml
packages:
  - '.'
  - 'pages'
  - 'packages/*' # ← 追加
```

### packages/exif-native/package.json

```json
{
  "name": "@vrchat-albums/exif-native",
  "version": "0.1.0",
  "main": "index.js",
  "types": "index.d.ts",
  "napi": {
    "name": "exif-native",
    "triples": {
      "defaults": true,
      "additional": ["aarch64-apple-darwin", "aarch64-pc-windows-msvc"]
    }
  },
  "scripts": {
    "build": "napi build --platform --release",
    "build:debug": "napi build --platform",
    "test": "vitest run"
  },
  "devDependencies": {
    "@napi-rs/cli": "^3.0.0"
  }
}
```

### packages/exif-native/Cargo.toml

```toml
[package]
name = "exif-native"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "3", features = ["napi9"] }
napi-derive = "3"
img-parts = "0.3"
roxmltree = "0.20"
quick-xml = "0.37"
rayon = "1.10"

[build-dependencies]
napi-build = "2"

[profile.release]
lto = true
strip = "symbols"
```

### ルートの package.json への統合

```jsonc
// dependencies に追加
"@vrchat-albums/exif-native": "workspace:*"

// rebuild-native スクリプトを更新
"rebuild-native": "npx @electron/rebuild -f -w clip-filepaths -w @vrchat-albums/exif-native"
```

### electron/vite.config.ts への追加

```typescript
export const electronExternal = [
  // ... 既存
  '@vrchat-albums/exif-native', // ← 追加
];
```

### electron-builder.cjs への追加

```javascript
asarUnpack: [
  // ... 既存
  'node_modules/@vrchat-albums/exif-native*/**',  // ← 追加
],
```

---

## 移行計画

### Phase 1: パッケージ作成 + XMP 読み取り

1. `packages/exif-native/` のスキャフォールド
2. XMP 読み取り実装（`readVrcXmp`, `readVrcXmpFromBuffer`, `readVrcXmpBatch`）
3. テスト（VRChat XMP 付き PNG/JPEG フィクスチャ）
4. monorepo 統合（pnpm workspace, vite external, electron-builder）

### Phase 2: EXIF 書き込み

1. EXIF IFD ライター実装（7 フィールド）
2. `writeExif`, `writeExifToBuffer` 実装
3. テスト

### Phase 3: 既存コードの置き換え

1. `wrappedExifTool.ts` の各関数を exif-native の呼び出しに置き換え
2. `vrchatPhotoMetadata/service.ts` の exifTagReader を置き換え
3. `worldJoinImage/service.ts` の setExifToBuffer を置き換え
4. exiftool-vendored を dependencies から削除
5. タイムアウト関連コード（makeTimeoutPromise, closeExiftoolInstance 等）を削除
6. プロセスライフサイクル管理コード（process.on('exit') 等）を削除

### Phase 4: 最適化

1. ベンチマーク（exiftool-vendored vs exif-native）
2. バッチ読み取りの並列数チューニング
3. メモリ使用量の確認

---

## 既存コードへの影響マッピング

| 既存ファイル                                     | 変更内容                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `electron/lib/wrappedExifTool.ts`                | exif-native の薄いラッパーに書き換え、または削除して直接呼び出し         |
| `electron/module/vrchatPhotoMetadata/service.ts` | `exifTagReader` を exif-native の `readVrcXmp` に置き換え                |
| `electron/module/vrchatPhotoMetadata/parser.ts`  | `extractOfficialMetadata` / `resolveStringTag` は不要に（Rust 側で処理） |
| `electron/module/worldJoinImage/service.ts`      | `setExifToBuffer` を exif-native の `writeExifToBuffer` に置き換え       |
| `electron/vite.config.ts`                        | electronExternal に追加                                                  |
| `electron-builder.cjs`                           | asarUnpack に追加                                                        |
| `package.json`                                   | dependency 追加、rebuild-native 更新、exiftool-vendored 削除             |
| `pnpm-workspace.yaml`                            | `packages/*` 追加                                                        |

---

## Description フィールドの扱い（EXIF vs XMP）

現在の書き込みでは `Description` と `ImageDescription` の 2 フィールドに書いている:

```typescript
await exifTool.write(filePath, {
  Description: description, // XMP dc:description
  ImageDescription: description, // EXIF IFD0 tag 0x010E
});
```

exiftool は `Description` を XMP の `dc:description` にマッピングする。
Rust 実装では:

- **EXIF IFD0**: `ImageDescription` (tag 0x010E) に書き込み
- **XMP**: 必要なら `dc:description` を XMP パケットとして別途書き込み

ただし、この書き込みは World Join Image 用であり、読み取りでは使われない。
写真管理ソフトでの表示のためなので、EXIF の `ImageDescription` だけで十分と思われる。

→ **判断ポイント: XMP の dc:description 書き込みも必要か？**
EXIF の ImageDescription のみで進め、必要になったら XMP 書き込みを追加する方針を推奨。

---

## CI/CD への影響

### ビルド

- CI で Rust ツールチェーンが必要になる
- GitHub Actions: `actions/setup-rust@v1` + `napi build --release`
- クロスコンパイル: 各 OS の CI ジョブで `napi build` を実行（現在と同じ方式）

### テスト

- Rust 単体テスト: `cargo test`（CI で追加）
- Node.js 統合テスト: `vitest`（packages/exif-native/**test**/）
- 既存テスト: wrappedExifTool.spec.ts は新 API に合わせて書き換え

---

## リスクと対策

| リスク                                        | 対策                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Rust ビルド環境のセットアップが複雑           | devcontainer に Rust ツールチェーンを追加                             |
| img-parts が一部 PNG チャンクに非対応         | テストで VRChat 実写真を使って検証                                    |
| EXIF IFD の手動構築にバグ                     | exiftool で読み戻して検証するテストを追加                             |
| @electron/rebuild との互換性                  | napi-rs の Electron 対応は実績あり（@napi-rs/image が同リポで使用中） |
| 既存の exiftool-vendored 依存コードの見落とし | grep で全参照を洗い出し済み                                           |
