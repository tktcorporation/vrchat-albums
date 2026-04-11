/// 画像ファイルの先頭バイトだけを読み取り、width/height を高速に取得する。
///
/// 背景: 写真インデックスでは画像の width/height だけが必要だが、
/// 従来は @napi-rs/image の Transformer でファイル全体をデコードしていた。
/// PNG なら先頭 24 バイト、JPEG なら SOF マーカーまでの数 KB で十分なため、
/// 部分読み込みで 10〜50 倍の高速化を実現する。
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use crate::detect::{detect_image_format, ImageFormat};

/// 画像の幅と高さ
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageDimensions {
    pub width: u32,
    pub height: u32,
}

/// PNG の IHDR チャンクに必要な最小バイト数。
/// signature(8) + chunk_length(4) + "IHDR"(4) + width(4) + height(4) = 24
const PNG_MIN_BYTES: usize = 24;

/// JPEG の SOF マーカーを探すためにファイルから一括読み込みする最大バイト数。
/// SOF がこの範囲内に見つからない場合、マーカーの length を使って
/// ファイルを seek してスキャンを続行する（上限なし）。
const JPEG_INITIAL_READ_BYTES: usize = 65536;

/// PNG バイト列の先頭から width/height を読み取る。
///
/// PNG 仕様では、シグネチャの直後に必ず IHDR チャンクが来る。
/// IHDR のデータ部先頭 8 バイトが width(4B, big-endian) + height(4B, big-endian)。
pub fn read_png_dimensions(data: &[u8]) -> Result<ImageDimensions, String> {
    if data.len() < PNG_MIN_BYTES {
        return Err(format!(
            "PNG data too short: {} bytes (need at least {})",
            data.len(),
            PNG_MIN_BYTES
        ));
    }

    // PNG signature check (8 bytes)
    const PNG_SIG: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if data[..8] != PNG_SIG {
        return Err("Not a valid PNG: signature mismatch".to_string());
    }

    // Bytes 8-11: IHDR chunk length (should be 13)
    // Bytes 12-15: chunk type (should be "IHDR")
    if &data[12..16] != b"IHDR" {
        return Err("Not a valid PNG: first chunk is not IHDR".to_string());
    }

    // Bytes 16-19: width (big-endian u32)
    let width = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
    // Bytes 20-23: height (big-endian u32)
    let height = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);

    Ok(ImageDimensions { width, height })
}

/// JPEG バイト列から SOF マーカーをスキャンして width/height を読み取る。
///
/// SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2), SOF3 (0xC3) を対象とする。
/// SOF ペイロード: precision(1B) + height(2B, big-endian) + width(2B, big-endian)
pub fn read_jpeg_dimensions(data: &[u8]) -> Result<ImageDimensions, String> {
    if data.len() < 2 {
        return Err("JPEG data too short".to_string());
    }

    // SOI marker check
    if data[0] != 0xFF || data[1] != 0xD8 {
        return Err("Not a valid JPEG: SOI marker (FFD8) not found".to_string());
    }

    let mut offset = 2;

    while offset < data.len() {
        // マーカーは 0xFF で始まる
        if data[offset] != 0xFF {
            return Err(format!(
                "Invalid JPEG: expected 0xFF marker at offset {}",
                offset
            ));
        }

        // 0xFF のパディングをスキップ（JPEG 仕様で複数の 0xFF が許容される）
        while offset < data.len() && data[offset] == 0xFF {
            offset += 1;
        }

        if offset >= data.len() {
            return Err("JPEG data truncated: no marker type after 0xFF".to_string());
        }

        let marker = data[offset];
        offset += 1;

        // SOF マーカー: フレームヘッダー（画像サイズを含む）
        // SOF0-3 (baseline/extended/progressive/lossless),
        // SOF5-7 (differential), SOF9-11 (arithmetic), SOF13-15 (differential arithmetic)
        // 0xC4 (DHT), 0xC8 (JPG), 0xCC (DAC) は寸法を持たないため除外
        if matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF) {
            // SOF payload: length(2B) + precision(1B) + height(2B) + width(2B)
            if offset + 7 > data.len() {
                return Err("JPEG data truncated: SOF marker too short".to_string());
            }
            // skip length(2B) + precision(1B) = 3 bytes
            let height = u16::from_be_bytes([data[offset + 3], data[offset + 4]]) as u32;
            let width = u16::from_be_bytes([data[offset + 5], data[offset + 6]]) as u32;
            return Ok(ImageDimensions { width, height });
        }

        // SOS (0xDA) / EOI (0xD9): 画像データに入ったので打ち切り
        if marker == 0xDA || marker == 0xD9 {
            return Err("JPEG: SOF marker not found before SOS/EOI".to_string());
        }

        // スタンドアロンマーカー（length フィールドなし）: RST0-RST7, TEM
        if (0xD0..=0xD7).contains(&marker) || marker == 0x01 {
            continue;
        }

        // その他のマーカー: length(2B) を読んでスキップ
        if offset + 2 > data.len() {
            return Err("JPEG data truncated: cannot read marker length".to_string());
        }
        let length = u16::from_be_bytes([data[offset], data[offset + 1]]) as usize;
        if length < 2 {
            return Err(format!(
                "Invalid JPEG marker length {} at offset {}",
                length,
                offset - 1
            ));
        }
        offset += length;
    }

    Err("JPEG: SOF marker not found".to_string())
}

/// ファイルパスから画像サイズを部分読み込みで取得する。
///
/// PNG: 先頭 24 バイトのみ読み込み
/// JPEG: 先頭 64KB を読み込み → SOF マーカースキャン
/// 不明なフォーマットはエラーを返す。
pub fn read_image_dimensions_from_file(file_path: &str) -> Result<ImageDimensions, String> {
    let mut file = File::open(file_path)
        .map_err(|e| format!("Failed to open file {file_path}: {e}"))?;

    // まず先頭 8 バイトを読んでフォーマット判定
    let mut header = [0u8; 8];
    file.read_exact(&mut header)
        .map_err(|e| format!("Failed to read header from {file_path}: {e}"))?;

    match detect_image_format(&header) {
        ImageFormat::Png => {
            // PNG: 残り 16 バイトを追加で読む（合計 24 バイト）
            let mut buf = [0u8; PNG_MIN_BYTES];
            buf[..8].copy_from_slice(&header);
            file.read_exact(&mut buf[8..])
                .map_err(|e| format!("Failed to read PNG IHDR from {file_path}: {e}"))?;
            read_png_dimensions(&buf)
        }
        ImageFormat::Jpeg => {
            // JPEG: まず先頭 64KB を一括読み込みして SOF を探す（大半はここで見つかる）
            let mut buf = vec![0u8; JPEG_INITIAL_READ_BYTES];
            buf[..8].copy_from_slice(&header);
            let n = file
                .read(&mut buf[8..])
                .map_err(|e| format!("Failed to read JPEG data from {file_path}: {e}"))?;
            buf.truncate(8 + n);

            match read_jpeg_dimensions(&buf) {
                Ok(dim) => Ok(dim),
                Err(_) if 8 + n >= JPEG_INITIAL_READ_BYTES => {
                    // 64KB で見つからなかった場合、マーカーベースで seek して続行
                    // SOF が大きなメタデータセグメント群の後にある場合に対応
                    read_jpeg_dimensions_from_file_seek(&mut file, file_path)
                }
                Err(e) => Err(e), // ファイルが 64KB 未満で見つからなかった → 本当にない
            }
        }
        ImageFormat::Unknown => {
            Err(format!("Unknown image format: {file_path}"))
        }
    }
}

/// JPEG ファイルをマーカーごとに seek してSOF を探す（フォールバック）。
///
/// 背景: 先頭 64KB の一括読み込みで SOF が見つからなかった場合に呼ばれる。
/// 大きな APP1 (EXIF) や複数の APPn セグメントがある場合に対応する。
/// ファイルの先頭（SOI の直後）から seek を開始する。
fn read_jpeg_dimensions_from_file_seek(
    file: &mut File,
    file_path: &str,
) -> Result<ImageDimensions, String> {
    // SOI の直後（offset 2）から開始
    file.seek(SeekFrom::Start(2))
        .map_err(|e| format!("Failed to seek in {file_path}: {e}"))?;

    let mut marker_buf = [0u8; 2];
    let mut length_buf = [0u8; 2];
    // SOF ペイロード: length(2) + precision(1) + height(2) + width(2) = 7 bytes
    let mut sof_buf = [0u8; 7];

    loop {
        // マーカー（0xFF + type）を読む
        file.read_exact(&mut marker_buf)
            .map_err(|e| format!("Failed to read JPEG marker from {file_path}: {e}"))?;

        if marker_buf[0] != 0xFF {
            return Err(format!(
                "Invalid JPEG marker in {file_path}: expected 0xFF, got 0x{:02X}",
                marker_buf[0]
            ));
        }

        // 0xFF パディングをスキップ
        let mut marker_type = marker_buf[1];
        while marker_type == 0xFF {
            let mut single = [0u8; 1];
            file.read_exact(&mut single)
                .map_err(|e| format!("Failed to read JPEG marker from {file_path}: {e}"))?;
            marker_type = single[0];
        }

        // SOF マーカー
        if matches!(marker_type, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF) {
            file.read_exact(&mut sof_buf)
                .map_err(|e| format!("Failed to read SOF data from {file_path}: {e}"))?;
            let height = u16::from_be_bytes([sof_buf[3], sof_buf[4]]) as u32;
            let width = u16::from_be_bytes([sof_buf[5], sof_buf[6]]) as u32;
            return Ok(ImageDimensions { width, height });
        }

        // SOS / EOI → 打ち切り
        if marker_type == 0xDA || marker_type == 0xD9 {
            return Err(format!("SOF marker not found in {file_path}"));
        }

        // スタンドアロンマーカー
        if (0xD0..=0xD7).contains(&marker_type) || marker_type == 0x01 {
            continue;
        }

        // length を読んでスキップ
        file.read_exact(&mut length_buf)
            .map_err(|e| format!("Failed to read marker length from {file_path}: {e}"))?;
        let length = u16::from_be_bytes(length_buf) as u64;
        if length < 2 {
            return Err(format!("Invalid marker length in {file_path}"));
        }
        // length にはlength フィールド自体の 2 バイトを含むので、残り length-2 バイトをスキップ
        file.seek(SeekFrom::Current((length - 2) as i64))
            .map_err(|e| format!("Failed to seek past marker in {file_path}: {e}"))?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // ========================================================================
    // テストヘルパー
    // ========================================================================

    /// 指定サイズの最小 PNG IHDR バイト列を構築する（signature + IHDR チャンク先頭部分）
    fn build_png_header(width: u32, height: u32) -> Vec<u8> {
        let mut buf = Vec::new();
        // PNG signature
        buf.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        // IHDR chunk: length = 13
        buf.extend_from_slice(&13u32.to_be_bytes());
        // chunk type
        buf.extend_from_slice(b"IHDR");
        // width, height
        buf.extend_from_slice(&width.to_be_bytes());
        buf.extend_from_slice(&height.to_be_bytes());
        buf
    }

    /// 最小限の JPEG バイト列を構築（SOI + 任意マーカー + SOF0 + EOI）
    fn build_jpeg_with_sof(
        width: u16,
        height: u16,
        sof_marker: u8,
        prefix_segments: &[(u8, &[u8])],
    ) -> Vec<u8> {
        let mut buf = Vec::new();
        // SOI
        buf.extend_from_slice(&[0xFF, 0xD8]);

        // prefix segments (e.g., APP0, APP1)
        for (marker, data) in prefix_segments {
            buf.push(0xFF);
            buf.push(*marker);
            let length = (data.len() + 2) as u16;
            buf.extend_from_slice(&length.to_be_bytes());
            buf.extend_from_slice(data);
        }

        // SOF marker
        buf.push(0xFF);
        buf.push(sof_marker);
        // SOF length: 2 (length) + 1 (precision) + 2 (height) + 2 (width) + 1 (components) + 3*components
        // 最小: 8 + 3 = 11, ここでは 11 を使用（1 component）
        let sof_length: u16 = 11;
        buf.extend_from_slice(&sof_length.to_be_bytes());
        buf.push(8); // precision
        buf.extend_from_slice(&height.to_be_bytes());
        buf.extend_from_slice(&width.to_be_bytes());
        buf.push(1); // number of components
        buf.extend_from_slice(&[0, 0x11, 0]); // component spec

        // EOI
        buf.extend_from_slice(&[0xFF, 0xD9]);

        buf
    }

    // ========================================================================
    // PNG テスト
    // ========================================================================

    #[test]
    fn reads_png_1x1() {
        let data = build_png_header(1, 1);
        let dim = read_png_dimensions(&data).unwrap();
        assert_eq!(dim, ImageDimensions { width: 1, height: 1 });
    }

    #[test]
    fn reads_png_1920x1080() {
        let data = build_png_header(1920, 1080);
        let dim = read_png_dimensions(&data).unwrap();
        assert_eq!(
            dim,
            ImageDimensions {
                width: 1920,
                height: 1080
            }
        );
    }

    #[test]
    fn reads_png_4096x2048() {
        let data = build_png_header(4096, 2048);
        let dim = read_png_dimensions(&data).unwrap();
        assert_eq!(
            dim,
            ImageDimensions {
                width: 4096,
                height: 2048
            }
        );
    }

    #[test]
    fn rejects_png_short_data() {
        let data = [0x89, 0x50, 0x4E, 0x47]; // only 4 bytes
        let result = read_png_dimensions(&data);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too short"));
    }

    #[test]
    fn rejects_png_wrong_magic() {
        let mut data = build_png_header(100, 100);
        data[0] = 0x00; // corrupt signature
        let result = read_png_dimensions(&data);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("signature mismatch"));
    }

    #[test]
    fn rejects_png_non_ihdr_first_chunk() {
        let mut data = build_png_header(100, 100);
        // Overwrite "IHDR" with "tEXt"
        data[12] = b't';
        data[13] = b'E';
        data[14] = b'X';
        data[15] = b't';
        let result = read_png_dimensions(&data);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not IHDR"));
    }

    // ========================================================================
    // JPEG テスト
    // ========================================================================

    #[test]
    fn reads_jpeg_sof0_baseline() {
        let data = build_jpeg_with_sof(1920, 1080, 0xC0, &[]);
        let dim = read_jpeg_dimensions(&data).unwrap();
        assert_eq!(
            dim,
            ImageDimensions {
                width: 1920,
                height: 1080
            }
        );
    }

    #[test]
    fn reads_jpeg_sof2_progressive() {
        let data = build_jpeg_with_sof(1280, 720, 0xC2, &[]);
        let dim = read_jpeg_dimensions(&data).unwrap();
        assert_eq!(
            dim,
            ImageDimensions {
                width: 1280,
                height: 720
            }
        );
    }

    #[test]
    fn reads_jpeg_sof9_arithmetic() {
        // SOF9 (arithmetic coding) もフレームヘッダーとして認識される
        let data = build_jpeg_with_sof(640, 480, 0xC9, &[]);
        let dim = read_jpeg_dimensions(&data).unwrap();
        assert_eq!(
            dim,
            ImageDimensions {
                width: 640,
                height: 480
            }
        );
    }

    #[test]
    fn reads_jpeg_sof13_differential_arithmetic() {
        // SOF13 (differential arithmetic) もフレームヘッダーとして認識される
        let data = build_jpeg_with_sof(800, 600, 0xCD, &[]);
        let dim = read_jpeg_dimensions(&data).unwrap();
        assert_eq!(
            dim,
            ImageDimensions {
                width: 800,
                height: 600
            }
        );
    }

    #[test]
    fn reads_jpeg_sof_after_app0_and_app1() {
        // APP0 (JFIF) + APP1 (EXIF placeholder) の後に SOF0
        let app0_data = b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00";
        let app1_data = vec![0u8; 1000]; // simulate 1KB EXIF data
        let data = build_jpeg_with_sof(
            3840,
            2160,
            0xC0,
            &[(0xE0, app0_data), (0xE1, &app1_data)],
        );
        let dim = read_jpeg_dimensions(&data).unwrap();
        assert_eq!(
            dim,
            ImageDimensions {
                width: 3840,
                height: 2160
            }
        );
    }

    #[test]
    fn reads_jpeg_sof_after_large_app1() {
        // 60KB の APP1 セグメント（大きな EXIF データをシミュレート）
        let large_app1 = vec![0u8; 60000];
        let data = build_jpeg_with_sof(2560, 1440, 0xC0, &[(0xE1, &large_app1)]);
        let dim = read_jpeg_dimensions(&data).unwrap();
        assert_eq!(
            dim,
            ImageDimensions {
                width: 2560,
                height: 1440
            }
        );
    }

    #[test]
    fn handles_jpeg_padding_ff() {
        // SOI の後に 0xFF パディングを挟む
        let mut data = Vec::new();
        data.extend_from_slice(&[0xFF, 0xD8]); // SOI
        data.extend_from_slice(&[0xFF, 0xFF, 0xFF, 0xC0]); // padded SOF0
        // SOF payload
        let sof_length: u16 = 11;
        data.extend_from_slice(&sof_length.to_be_bytes());
        data.push(8); // precision
        data.extend_from_slice(&720u16.to_be_bytes()); // height
        data.extend_from_slice(&1280u16.to_be_bytes()); // width
        data.push(1);
        data.extend_from_slice(&[0, 0x11, 0]);
        data.extend_from_slice(&[0xFF, 0xD9]); // EOI

        let dim = read_jpeg_dimensions(&data).unwrap();
        assert_eq!(
            dim,
            ImageDimensions {
                width: 1280,
                height: 720
            }
        );
    }

    #[test]
    fn rejects_jpeg_truncated() {
        // SOI + APP0 marker but no SOF
        let data = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46];
        let result = read_jpeg_dimensions(&data);
        assert!(result.is_err());
    }

    #[test]
    fn rejects_jpeg_wrong_soi() {
        let data = [0x00, 0x00, 0xFF, 0xC0];
        let result = read_jpeg_dimensions(&data);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("SOI"));
    }

    #[test]
    fn rejects_jpeg_too_short() {
        let result = read_jpeg_dimensions(&[0xFF]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too short"));
    }

    // ========================================================================
    // 境界値テスト
    // ========================================================================

    #[test]
    fn reads_png_zero_dimensions() {
        // 0x0 画像は PNG 仕様上は不正だが、パーサーはバイトをそのまま読む
        let data = build_png_header(0, 0);
        let dim = read_png_dimensions(&data).unwrap();
        assert_eq!(dim, ImageDimensions { width: 0, height: 0 });
    }

    #[test]
    fn reads_jpeg_zero_height_in_sof() {
        // DNL JPEG: SOF の height が 0（後から DNL マーカーで設定される仕様）
        // パーサーは height=0 をそのまま返す
        let data = build_jpeg_with_sof(1920, 0, 0xC0, &[]);
        let dim = read_jpeg_dimensions(&data).unwrap();
        assert_eq!(dim, ImageDimensions { width: 1920, height: 0 });
    }

    #[test]
    fn skips_c8_jpg_extension_marker_and_finds_sof0() {
        // 0xC8 (JPG extension) は SOF ではない — length 付きマーカーとしてスキップされる
        let mut data = Vec::new();
        data.extend_from_slice(&[0xFF, 0xD8]); // SOI
        // 0xC8 marker with dummy payload
        data.extend_from_slice(&[0xFF, 0xC8]);
        data.extend_from_slice(&[0x00, 0x04]); // length=4 (2 for length + 2 dummy)
        data.extend_from_slice(&[0x00, 0x00]); // dummy data
        // SOF0
        data.push(0xFF);
        data.push(0xC0);
        let sof_length: u16 = 11;
        data.extend_from_slice(&sof_length.to_be_bytes());
        data.push(8); // precision
        data.extend_from_slice(&1080u16.to_be_bytes()); // height
        data.extend_from_slice(&1920u16.to_be_bytes()); // width
        data.push(1);
        data.extend_from_slice(&[0, 0x11, 0]);
        data.extend_from_slice(&[0xFF, 0xD9]); // EOI

        let dim = read_jpeg_dimensions(&data).unwrap();
        assert_eq!(
            dim,
            ImageDimensions {
                width: 1920,
                height: 1080
            }
        );
    }

    // ========================================================================
    // ファイルベーステスト
    // ========================================================================

    #[test]
    fn returns_err_for_nonexistent_file() {
        let result = read_image_dimensions_from_file("/nonexistent/path/image.png");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to open"));
    }

    #[test]
    fn returns_err_for_unknown_format() {
        // 一時ファイルにランダムデータを書き込む
        let dir = std::env::temp_dir();
        let path = dir.join("test_unknown_format.dat");
        let mut f = File::create(&path).unwrap();
        f.write_all(&[0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])
            .unwrap();
        drop(f);

        let result = read_image_dimensions_from_file(path.to_str().unwrap());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown image format"));

        // クリーンアップ
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn reads_dimensions_from_png_file() {
        let dir = std::env::temp_dir();
        let path = dir.join("test_dim_1920x1080.png");
        let header = build_png_header(1920, 1080);
        // IHDR の残り（bit depth 以降）も書く必要がある
        let mut full = header.clone();
        // bit depth(1) + color type(1) + compression(1) + filter(1) + interlace(1) = 5 bytes
        full.extend_from_slice(&[8, 2, 0, 0, 0]);
        let mut f = File::create(&path).unwrap();
        f.write_all(&full).unwrap();
        drop(f);

        let dim = read_image_dimensions_from_file(path.to_str().unwrap()).unwrap();
        assert_eq!(
            dim,
            ImageDimensions {
                width: 1920,
                height: 1080
            }
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn reads_dimensions_from_jpeg_file() {
        let dir = std::env::temp_dir();
        let path = dir.join("test_dim_1920x1080.jpeg");
        let data = build_jpeg_with_sof(1920, 1080, 0xC0, &[]);
        let mut f = File::create(&path).unwrap();
        f.write_all(&data).unwrap();
        drop(f);

        let dim = read_image_dimensions_from_file(path.to_str().unwrap()).unwrap();
        assert_eq!(
            dim,
            ImageDimensions {
                width: 1920,
                height: 1080
            }
        );

        let _ = std::fs::remove_file(&path);
    }
}
