/// ファイルの先頭から必要最小限だけ読み取り、VRChat XMP メタデータを高速抽出する。
///
/// 背景: 従来の `read_vrc_xmp` は `fs::read` でファイル全体（数MB）をメモリに載せていたが、
/// XMP は PNG なら iTXt チャンク、JPEG なら APP1 セグメントに格納され、
/// いずれもファイル先頭付近にある。画像データ本体（PNG IDAT / JPEG SOS 以降）を
/// 読む必要はないため、チャンクヘッダーだけ走査して XMP 部分だけ読み込む。
///
/// BufReader(64KB) で小さな read_exact を OS syscall に変換せずバッファ上で処理し、
/// dimensions.rs と同等の I/O 効率を実現する。
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};

use crate::detect::{detect_image_format, ImageFormat};
use crate::xmp::reader::{parse_vrc_xmp, VrcXmpMetadata};

/// BufReader のバッファサイズ。
///
/// 背景: JPEG は SOI(2B) + APPn セグメント群の後に SOS が来る。
/// 典型的な VRChat 写真では APP0(JFIF) + APP1(EXIF/XMP) + DQT + DHT + SOF で
/// 数 KB〜数十 KB。64KB あればほぼ全てのマーカー走査を 1 回の read で賄える。
/// dimensions.rs の JPEG_INITIAL_READ_BYTES と同じサイズ。
const BUF_READER_CAPACITY: usize = 65536;

/// ファイルフォーマットを自動判定し、部分読み込みで XMP メタデータを抽出する。
///
/// PNG / JPEG いずれもファイル全体を読まず、チャンク/セグメントヘッダーを
/// 走査して XMP データだけを読み取る。XMP が存在しなければ None を返す。
pub fn read_xmp_from_file(path: &str) -> Result<Option<VrcXmpMetadata>, String> {
    let file =
        File::open(path).map_err(|e| format!("Failed to open {path}: {e}"))?;
    let mut reader = BufReader::with_capacity(BUF_READER_CAPACITY, file);

    // フォーマット判定: 先頭 8 バイトを確実に読む（BufReader から提供）。
    // read() ではなく read_exact() を使用: read() はバッファを満たさずに返る可能性があり、
    // 部分的な読み取りでフォーマット誤判定になりうるため。
    // 8B 未満のファイルは UnexpectedEof → Unknown format として扱う。
    let mut magic = [0u8; 8];
    match reader.read_exact(&mut magic) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Ok(None); // 8B 未満のファイル — 画像ではないので XMP なし
        }
        Err(e) => {
            return Err(format!("Failed to read magic bytes from {path}: {e}"));
        }
    }

    match detect_image_format(&magic) {
        ImageFormat::Png => read_xmp_from_png_stream(&mut reader),
        ImageFormat::Jpeg => read_xmp_from_jpeg_stream(&mut reader),
        ImageFormat::Unknown => Ok(None),
    }
}

/// JPEG ファイルから部分読み込みで XMP を抽出する。
///
/// SOI の後、マーカーセグメントを順に走査する。
/// APP1 (0xE1) + XMP プレフィックス が見つかったらそのセグメントだけ読む。
/// SOS (0xDA) / EOI (0xD9) に到達したら打ち切り（XMP は SOS の前に格納される）。
///
/// reader は read_xmp_from_file でフォーマット判定後の状態。絶対シークで開始位置に移動する。
fn read_xmp_from_jpeg_stream(reader: &mut BufReader<File>) -> Result<Option<VrcXmpMetadata>, String> {
    // read_xmp_from_file がフォーマット判定で先頭 8B を読むため
    // オフセットが不定。絶対シークで SOI 直後 (offset 2) に移動する。
    reader.seek(SeekFrom::Start(2))
        .map_err(|e| format!("Failed to seek past SOI: {e}"))?;

    const XMP_PREFIX: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";

    loop {
        // マーカー先頭 0xFF を読む
        let mut byte = [0u8; 1];
        match reader.read_exact(&mut byte) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                return Ok(None); // 正常な EOF — XMP なし
            }
            Err(e) => {
                return Err(format!("Failed to read JPEG marker: {e}"));
            }
        }

        if byte[0] != 0xFF {
            return Ok(None); // 不正なマーカー — 安全側に倒して None
        }

        // fill bytes (0xFF の連続) をスキップして実際のマーカー種別を取得。
        // JPEG spec では 0xFF の後に任意個の 0xFF fill bytes を挿入できる。
        // BufReader により、1バイトずつの read_exact はバッファから提供される。
        let marker_type;
        loop {
            reader.read_exact(&mut byte)
                .map_err(|e| format!("Failed to read JPEG marker type: {e}"))?;
            if byte[0] != 0xFF {
                break;
            }
        }
        marker_type = byte[0];

        // 0xFF 0x00 はバイトスタッフィング（SOS 以降のスキャンデータ内で使われる）。
        // ヘッダー領域では出現しないはずだが、不正なファイルの場合はスキップする。
        if marker_type == 0x00 {
            continue;
        }

        // スタンドアロンマーカー（長さフィールドなし）: RST0-RST7, TEM
        if (0xD0..=0xD7).contains(&marker_type) || marker_type == 0x01 {
            continue;
        }

        // SOS (0xDA) / EOI (0xD9) — XMP はこれより前にあるので打ち切り
        if marker_type == 0xDA || marker_type == 0xD9 {
            return Ok(None);
        }

        // セグメント長 (2 bytes, big-endian, 自身を含む)
        let mut len_bytes = [0u8; 2];
        reader.read_exact(&mut len_bytes)
            .map_err(|e| format!("Failed to read segment length: {e}"))?;
        let seg_len = u16::from_be_bytes(len_bytes) as usize;

        if seg_len < 2 {
            return Err("Invalid JPEG segment length".to_string());
        }

        let data_len = seg_len - 2;

        // APP1 (0xE1) — XMP の可能性あり
        if marker_type == 0xE1 && data_len > XMP_PREFIX.len() {
            // プレフィックスだけ読んで XMP か判定
            let mut prefix_buf = vec![0u8; XMP_PREFIX.len()];
            reader.read_exact(&mut prefix_buf)
                .map_err(|e| format!("Failed to read APP1 prefix: {e}"))?;

            if prefix_buf == XMP_PREFIX {
                // XMP データ本体だけ読み取り
                let xmp_len = data_len - XMP_PREFIX.len();
                let mut xmp_buf = vec![0u8; xmp_len];
                reader.read_exact(&mut xmp_buf)
                    .map_err(|e| format!("Failed to read XMP data: {e}"))?;

                let xml_text = match String::from_utf8(xmp_buf) {
                    Ok(s) => s,
                    Err(_) => return Ok(None), // 不正な UTF-8 — XMP なし扱い
                };
                return Ok(parse_vrc_xmp(&xml_text));
            }

            // XMP ではない APP1 — 残りをスキップ
            let remaining = (data_len - XMP_PREFIX.len()) as i64;
            reader.seek(SeekFrom::Current(remaining))
                .map_err(|e| format!("Failed to skip non-XMP APP1: {e}"))?;
        } else {
            // APP1 以外のセグメント — スキップ
            reader.seek(SeekFrom::Current(data_len as i64))
                .map_err(|e| format!("Failed to skip segment: {e}"))?;
        }
    }
}

/// PNG ファイルから部分読み込みで XMP を抽出する。
///
/// シグネチャの後、チャンクヘッダー (8B: length + type) を順に走査する。
/// iTXt + keyword "XML:com.adobe.xmp" が見つかったらそのチャンクだけ読む。
/// IEND に到達したら打ち切り。IDAT はスキップして走査を続行する
/// （サードパーティツールで iTXt が IDAT 後に移動する場合に対応）。
///
/// reader は read_xmp_from_file でフォーマット判定後の状態。絶対シークで開始位置に移動する。
fn read_xmp_from_png_stream(reader: &mut BufReader<File>) -> Result<Option<VrcXmpMetadata>, String> {
    // read_xmp_from_file がフォーマット判定で先頭 8B を読むため
    // オフセットが不定。絶対シークでシグネチャ直後 (offset 8) に移動する。
    reader.seek(SeekFrom::Start(8))
        .map_err(|e| format!("Failed to seek past PNG signature: {e}"))?;

    const XMP_KEYWORD: &[u8] = b"XML:com.adobe.xmp";
    // VRChat XMP は通常 1KB 未満。8MB を超える iTXt は異常値として扱いスキップする。
    // 悪意のある PNG でメモリを枯渇させる攻撃を防ぐ。
    const MAX_ITXT_CHUNK_SIZE: usize = 8 * 1024 * 1024;

    loop {
        // チャンクヘッダー: length (4B) + type (4B)
        let mut header = [0u8; 8];
        match reader.read_exact(&mut header) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                return Ok(None); // 正常な EOF — XMP なし
            }
            Err(e) => {
                return Err(format!("Failed to read PNG chunk header: {e}"));
            }
        }

        let chunk_len =
            u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as usize;
        let chunk_type = [header[4], header[5], header[6], header[7]];

        // IEND — ファイル末尾なので打ち切り
        if chunk_type == *b"IEND" {
            return Ok(None);
        }

        // IDAT は画像データ本体。VRChat は XMP を IDAT の前に配置するが、
        // サードパーティツールで再エンコードされた写真では iTXt が IDAT の後に
        // 移動する可能性がある (PNG spec では ancillary chunk の位置は自由)。
        // 互換性のため IDAT はスキップして走査を続行する。
        // IDAT のデータ本体は読まず seek で飛ばすのでI/Oコストは最小限。

        if chunk_type == *b"iTXt" {
            // サイズ上限チェック: 異常に大きい iTXt はスキップ（OOM 防止）
            if chunk_len > MAX_ITXT_CHUNK_SIZE {
                let skip = chunk_len as i64 + 4; // data + CRC
                reader.seek(SeekFrom::Current(skip))
                    .map_err(|e| format!("Failed to skip oversized iTXt chunk: {e}"))?;
                continue;
            }
            // iTXt チャンクデータを読み取り
            let mut chunk_data = vec![0u8; chunk_len];
            reader.read_exact(&mut chunk_data)
                .map_err(|e| format!("Failed to read iTXt chunk: {e}"))?;

            // CRC (4B) をスキップ
            reader.seek(SeekFrom::Current(4))
                .map_err(|e| format!("Failed to skip CRC: {e}"))?;

            // keyword チェック (null-terminated)
            let keyword_end = match chunk_data.iter().position(|&b| b == 0) {
                Some(pos) => pos,
                None => continue, // 不正な iTXt — 次のチャンクへ
            };

            if &chunk_data[..keyword_end] != XMP_KEYWORD {
                continue; // XMP ではない iTXt
            }

            // iTXt 構造をパース（png.rs と同じロジック）
            let mut offset = keyword_end + 1; // null terminator をスキップ
            if offset + 2 > chunk_data.len() {
                continue;
            }

            let compression_flag = chunk_data[offset];
            offset += 2; // compression flag + method をスキップ

            if compression_flag != 0 {
                continue; // 圧縮 XMP は VRChat では使われないため未対応
            }

            // language tag (null-terminated) をスキップ
            match chunk_data[offset..].iter().position(|&b| b == 0) {
                Some(pos) => offset += pos + 1,
                None => continue,
            }

            // translated keyword (null-terminated) をスキップ
            match chunk_data[offset..].iter().position(|&b| b == 0) {
                Some(pos) => offset += pos + 1,
                None => continue,
            }

            // 残りが XMP XML テキスト
            let xml_text = match String::from_utf8(chunk_data[offset..].to_vec()) {
                Ok(s) => s,
                Err(_) => continue, // 不正な UTF-8 — 次のチャンクへ
            };

            return Ok(parse_vrc_xmp(&xml_text));
        } else {
            // iTXt 以外のチャンク — データ + CRC (4B) をスキップ
            let skip = chunk_len as i64 + 4;
            reader.seek(SeekFrom::Current(skip))
                .map_err(|e| format!("Failed to skip chunk: {e}"))?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    // ========================================================================
    // テストヘルパー: JPEG 構築
    // ========================================================================

    /// XMP APP1 セグメント付きの最小 JPEG を構築する
    fn build_jpeg_with_xmp(xmp_xml: &str) -> Vec<u8> {
        let mut buf = Vec::new();

        // SOI
        buf.extend_from_slice(&[0xFF, 0xD8]);

        // APP0 (JFIF) — 最小限
        let jfif_data = b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00";
        let jfif_len = (jfif_data.len() + 2) as u16;
        buf.extend_from_slice(&[0xFF, 0xE0]);
        buf.extend_from_slice(&jfif_len.to_be_bytes());
        buf.extend_from_slice(jfif_data);

        // APP1 (XMP)
        let xmp_prefix = b"http://ns.adobe.com/xap/1.0/\0";
        let app1_data_len = xmp_prefix.len() + xmp_xml.len();
        let app1_seg_len = (app1_data_len + 2) as u16;
        buf.extend_from_slice(&[0xFF, 0xE1]);
        buf.extend_from_slice(&app1_seg_len.to_be_bytes());
        buf.extend_from_slice(xmp_prefix);
        buf.extend_from_slice(xmp_xml.as_bytes());

        // SOS (終端マーカー)
        buf.extend_from_slice(&[0xFF, 0xDA]);
        buf.extend_from_slice(&[0x00, 0x02]); // length = 2

        // EOI
        buf.extend_from_slice(&[0xFF, 0xD9]);

        buf
    }

    /// XMP なしの最小 JPEG
    fn build_jpeg_without_xmp() -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&[0xFF, 0xD8]); // SOI
        buf.extend_from_slice(&[0xFF, 0xDA]); // SOS
        buf.extend_from_slice(&[0x00, 0x02]); // length
        buf.extend_from_slice(&[0xFF, 0xD9]); // EOI
        buf
    }

    // ========================================================================
    // テストヘルパー: PNG 構築
    // ========================================================================

    /// CRC-32 (PNG polynomial)
    fn crc32_png(data: &[u8]) -> u32 {
        let mut crc: u32 = 0xFFFFFFFF;
        for &byte in data {
            crc ^= byte as u32;
            for _ in 0..8 {
                if crc & 1 != 0 {
                    crc = (crc >> 1) ^ 0xEDB88320;
                } else {
                    crc >>= 1;
                }
            }
        }
        crc ^ 0xFFFFFFFF
    }

    fn write_png_chunk(buf: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) {
        buf.extend_from_slice(&(data.len() as u32).to_be_bytes());
        buf.extend_from_slice(chunk_type);
        buf.extend_from_slice(data);
        let mut crc_input = Vec::with_capacity(4 + data.len());
        crc_input.extend_from_slice(chunk_type);
        crc_input.extend_from_slice(data);
        let crc = crc32_png(&crc_input);
        buf.extend_from_slice(&crc.to_be_bytes());
    }

    /// XMP iTXt チャンク付きの最小 PNG を構築する
    fn build_png_with_xmp(xmp_xml: &str) -> Vec<u8> {
        let mut buf = Vec::new();

        // PNG signature
        buf.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

        // IHDR (1x1 grayscale)
        let ihdr_data: [u8; 13] = [
            0, 0, 0, 1, // width
            0, 0, 0, 1, // height
            8, 0, 0, 0, 0, // bit depth, color type, compression, filter, interlace
        ];
        write_png_chunk(&mut buf, b"IHDR", &ihdr_data);

        // iTXt (XMP)
        let mut itxt_data = Vec::new();
        itxt_data.extend_from_slice(b"XML:com.adobe.xmp"); // keyword
        itxt_data.push(0); // null terminator
        itxt_data.push(0); // compression flag = 0
        itxt_data.push(0); // compression method
        itxt_data.push(0); // language tag (empty, null terminated)
        itxt_data.push(0); // translated keyword (empty, null terminated)
        itxt_data.extend_from_slice(xmp_xml.as_bytes());
        write_png_chunk(&mut buf, b"iTXt", &itxt_data);

        // IDAT (minimal)
        write_png_chunk(
            &mut buf,
            b"IDAT",
            &[0x78, 0x01, 0x62, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01],
        );

        // IEND
        write_png_chunk(&mut buf, b"IEND", &[]);

        buf
    }

    /// XMP なしの最小 PNG
    fn build_png_without_xmp() -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        let ihdr_data: [u8; 13] = [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0];
        write_png_chunk(&mut buf, b"IHDR", &ihdr_data);
        write_png_chunk(
            &mut buf,
            b"IDAT",
            &[0x78, 0x01, 0x62, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01],
        );
        write_png_chunk(&mut buf, b"IEND", &[]);
        buf
    }

    /// バイト列をテンポラリファイルに書き込み、パスを返す
    fn write_temp_file(data: &[u8]) -> NamedTempFile {
        let mut tmp = NamedTempFile::new().expect("Failed to create temp file");
        tmp.write_all(data).expect("Failed to write temp file");
        tmp.flush().expect("Failed to flush temp file");
        tmp
    }

    // ========================================================================
    // VRChat XMP テストデータ
    // ========================================================================

    const VRCHAT_XMP: &str = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
    <rdf:Description>
      <xmp:Author>tkt_</xmp:Author>
    </rdf:Description>
    <rdf:Description xmlns:vrc="http://ns.vrchat.com/vrc/1.0/">
      <vrc:WorldID>wrld_b7280487-a1bc-41e2-80f2-942a72e7d2c7</vrc:WorldID>
      <vrc:WorldDisplayName>Hanami Days</vrc:WorldDisplayName>
      <vrc:AuthorID>usr_3ba2a992-724c-4463-bc75-7e9f6674e8e0</vrc:AuthorID>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>"#;

    // ========================================================================
    // JPEG テスト
    // ========================================================================

    #[test]
    fn jpeg_with_xmp_extracts_metadata() {
        let data = build_jpeg_with_xmp(VRCHAT_XMP);
        let tmp = write_temp_file(&data);
        let result = read_xmp_from_file(tmp.path().to_str().unwrap());
        assert!(result.is_ok());
        let meta = result.unwrap().expect("Expected Some metadata");
        assert_eq!(
            meta.author_id.as_deref(),
            Some("usr_3ba2a992-724c-4463-bc75-7e9f6674e8e0")
        );
        assert_eq!(meta.author.as_deref(), Some("tkt_"));
        assert_eq!(
            meta.world_id.as_deref(),
            Some("wrld_b7280487-a1bc-41e2-80f2-942a72e7d2c7")
        );
        assert_eq!(
            meta.world_display_name.as_deref(),
            Some("Hanami Days")
        );
    }

    #[test]
    fn jpeg_with_ff_fill_bytes_before_marker() {
        // JPEG spec: マーカー前に任意個の 0xFF fill bytes を挿入できる。
        // 以前のコードは seek(-1) で無限ループしていたバグの回帰テスト。
        let mut buf = Vec::new();
        buf.extend_from_slice(&[0xFF, 0xD8]); // SOI

        // 0xFF fill bytes (3個) + APP1 XMP marker
        buf.extend_from_slice(&[0xFF, 0xFF, 0xFF, 0xFF]); // 3 fill bytes + marker start
        buf.push(0xE1); // APP1

        let xmp_prefix = b"http://ns.adobe.com/xap/1.0/\0";
        let app1_data_len = xmp_prefix.len() + VRCHAT_XMP.len();
        let app1_seg_len = (app1_data_len + 2) as u16;
        buf.extend_from_slice(&app1_seg_len.to_be_bytes());
        buf.extend_from_slice(xmp_prefix);
        buf.extend_from_slice(VRCHAT_XMP.as_bytes());

        buf.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x02]); // SOS
        buf.extend_from_slice(&[0xFF, 0xD9]); // EOI

        let tmp = write_temp_file(&buf);
        let result = read_xmp_from_file(tmp.path().to_str().unwrap());
        assert!(result.is_ok());
        let meta = result.unwrap().expect("Expected metadata after fill bytes");
        assert_eq!(
            meta.author_id.as_deref(),
            Some("usr_3ba2a992-724c-4463-bc75-7e9f6674e8e0")
        );
    }

    #[test]
    fn jpeg_without_xmp_returns_none() {
        let data = build_jpeg_without_xmp();
        let tmp = write_temp_file(&data);
        let result = read_xmp_from_file(tmp.path().to_str().unwrap());
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn jpeg_with_non_xmp_app1_skips_it() {
        // EXIF APP1 (XMP ではない) + SOS の JPEG
        let mut buf = Vec::new();
        buf.extend_from_slice(&[0xFF, 0xD8]); // SOI

        // APP1 with EXIF prefix (not XMP)
        let exif_data = b"Exif\x00\x00fake-exif-data";
        let seg_len = (exif_data.len() + 2) as u16;
        buf.extend_from_slice(&[0xFF, 0xE1]);
        buf.extend_from_slice(&seg_len.to_be_bytes());
        buf.extend_from_slice(exif_data);

        buf.extend_from_slice(&[0xFF, 0xDA]); // SOS
        buf.extend_from_slice(&[0x00, 0x02]);
        buf.extend_from_slice(&[0xFF, 0xD9]); // EOI

        let tmp = write_temp_file(&buf);
        let result = read_xmp_from_file(tmp.path().to_str().unwrap());
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    // ========================================================================
    // PNG テスト
    // ========================================================================

    #[test]
    fn png_with_xmp_extracts_metadata() {
        let data = build_png_with_xmp(VRCHAT_XMP);
        let tmp = write_temp_file(&data);
        let result = read_xmp_from_file(tmp.path().to_str().unwrap());
        assert!(result.is_ok());
        let meta = result.unwrap().expect("Expected Some metadata");
        assert_eq!(
            meta.author_id.as_deref(),
            Some("usr_3ba2a992-724c-4463-bc75-7e9f6674e8e0")
        );
        assert_eq!(meta.author.as_deref(), Some("tkt_"));
        assert_eq!(
            meta.world_id.as_deref(),
            Some("wrld_b7280487-a1bc-41e2-80f2-942a72e7d2c7")
        );
    }

    #[test]
    fn png_without_xmp_returns_none() {
        let data = build_png_without_xmp();
        let tmp = write_temp_file(&data);
        let result = read_xmp_from_file(tmp.path().to_str().unwrap());
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn png_with_non_xmp_itxt_skips_it() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

        let ihdr_data: [u8; 13] = [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0];
        write_png_chunk(&mut buf, b"IHDR", &ihdr_data);

        // iTXt with different keyword (not XMP)
        let mut itxt_data = Vec::new();
        itxt_data.extend_from_slice(b"Comment");
        itxt_data.push(0); // null
        itxt_data.push(0); // compression flag
        itxt_data.push(0); // compression method
        itxt_data.push(0); // language tag
        itxt_data.push(0); // translated keyword
        itxt_data.extend_from_slice(b"Just a comment");
        write_png_chunk(&mut buf, b"iTXt", &itxt_data);

        write_png_chunk(
            &mut buf,
            b"IDAT",
            &[0x78, 0x01, 0x62, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01],
        );
        write_png_chunk(&mut buf, b"IEND", &[]);

        let tmp = write_temp_file(&buf);
        let result = read_xmp_from_file(tmp.path().to_str().unwrap());
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    // ========================================================================
    // エラーケース
    // ========================================================================

    #[test]
    fn nonexistent_file_returns_error() {
        let result = read_xmp_from_file("/nonexistent/path/to/file.png");
        assert!(result.is_err());
    }

    #[test]
    fn unknown_format_returns_none() {
        let tmp = write_temp_file(b"not an image file");
        let result = read_xmp_from_file(tmp.path().to_str().unwrap());
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn png_with_xmp_after_idat_still_extracts() {
        // サードパーティツールで再エンコードされた PNG では
        // iTXt (XMP) が IDAT の後に配置される場合がある。
        // streaming_reader は IDAT をスキップして走査を続行するため、
        // IDAT 後の XMP も正しく抽出できる。
        let mut buf = Vec::new();
        buf.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

        let ihdr_data: [u8; 13] = [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0];
        write_png_chunk(&mut buf, b"IHDR", &ihdr_data);

        // IDAT first (画像データ)
        write_png_chunk(
            &mut buf,
            b"IDAT",
            &[0x78, 0x01, 0x62, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01],
        );

        // iTXt (XMP) AFTER IDAT
        let mut itxt_data = Vec::new();
        itxt_data.extend_from_slice(b"XML:com.adobe.xmp");
        itxt_data.push(0); // null
        itxt_data.push(0); // compression flag
        itxt_data.push(0); // compression method
        itxt_data.push(0); // language tag
        itxt_data.push(0); // translated keyword
        itxt_data.extend_from_slice(VRCHAT_XMP.as_bytes());
        write_png_chunk(&mut buf, b"iTXt", &itxt_data);

        write_png_chunk(&mut buf, b"IEND", &[]);

        let tmp = write_temp_file(&buf);
        let result = read_xmp_from_file(tmp.path().to_str().unwrap());
        assert!(result.is_ok());
        let meta = result.unwrap().expect("Expected Some metadata for XMP after IDAT");
        assert_eq!(
            meta.author_id.as_deref(),
            Some("usr_3ba2a992-724c-4463-bc75-7e9f6674e8e0")
        );
    }

    #[test]
    fn empty_file_returns_none() {
        let tmp = write_temp_file(b"");
        let result = read_xmp_from_file(tmp.path().to_str().unwrap());
        // 空ファイルは Unknown format → None
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn jpeg_with_japanese_xmp_extracts_correctly() {
        let xmp = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
    <rdf:Description>
      <xmp:Author>日本語ユーザー</xmp:Author>
    </rdf:Description>
    <rdf:Description xmlns:vrc="http://ns.vrchat.com/vrc/1.0/">
      <vrc:AuthorID>usr_test</vrc:AuthorID>
      <vrc:WorldID>wrld_test</vrc:WorldID>
      <vrc:WorldDisplayName>お花見ワールド 🌸</vrc:WorldDisplayName>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>"#;

        let data = build_jpeg_with_xmp(xmp);
        let tmp = write_temp_file(&data);
        let result = read_xmp_from_file(tmp.path().to_str().unwrap());
        assert!(result.is_ok());
        let meta = result.unwrap().expect("Expected metadata");
        assert_eq!(meta.author.as_deref(), Some("日本語ユーザー"));
        assert_eq!(
            meta.world_display_name.as_deref(),
            Some("お花見ワールド 🌸")
        );
    }
}
