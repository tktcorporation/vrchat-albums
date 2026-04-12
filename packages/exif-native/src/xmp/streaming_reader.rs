/// ファイルの先頭から必要最小限だけ読み取り、VRChat XMP メタデータを高速抽出する。
///
/// 背景: 従来の `read_vrc_xmp` は `fs::read` でファイル全体（数MB）をメモリに載せていたが、
/// XMP は PNG なら iTXt チャンク、JPEG なら APP1 セグメントに格納され、
/// いずれもファイル先頭付近にある。画像データ本体（PNG IDAT / JPEG SOS 以降）を
/// 読む必要はないため、チャンクヘッダーだけ走査して XMP 部分だけ読み込む。
///
/// dimensions.rs と同じ部分読み込みパターン。3000枚超のバッチ処理で
/// 数GB の I/O を数百MB に削減し、10〜50 倍の高速化を実現する。
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use crate::detect::{detect_image_format_from_file, ImageFormat};
use crate::xmp::reader::{parse_vrc_xmp, VrcXmpMetadata};

/// ファイルフォーマットを自動判定し、部分読み込みで XMP メタデータを抽出する。
///
/// PNG / JPEG いずれもファイル全体を読まず、チャンク/セグメントヘッダーを
/// 走査して XMP データだけを読み取る。XMP が存在しなければ None を返す。
pub fn read_xmp_from_file(path: &str) -> Result<Option<VrcXmpMetadata>, String> {
    let mut file =
        File::open(path).map_err(|e| format!("Failed to open {path}: {e}"))?;

    match detect_image_format_from_file(&mut file)? {
        ImageFormat::Png => read_xmp_from_png_stream(&mut file),
        ImageFormat::Jpeg => read_xmp_from_jpeg_stream(&mut file),
        ImageFormat::Unknown => Ok(None),
    }
}

/// JPEG ファイルから部分読み込みで XMP を抽出する。
///
/// SOI の後、マーカーセグメントを順に走査する。
/// APP1 (0xE1) + XMP プレフィックス が見つかったらそのセグメントだけ読む。
/// SOS (0xDA) / EOI (0xD9) に到達したら打ち切り（XMP は SOS の前に格納される）。
///
/// file は先頭にシーク済みであること（detect_image_format_from_file が先頭を読む）。
fn read_xmp_from_jpeg_stream(file: &mut File) -> Result<Option<VrcXmpMetadata>, String> {
    // SOI (2 bytes) は detect で読み済み → オフセット 2 から開始
    file.seek(SeekFrom::Start(2))
        .map_err(|e| format!("Failed to seek past SOI: {e}"))?;

    const XMP_PREFIX: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";

    loop {
        // マーカー読み取り (2 bytes: 0xFF + marker_type)
        let mut marker = [0u8; 2];
        if file.read_exact(&mut marker).is_err() {
            return Ok(None); // EOF — XMP なし
        }

        if marker[0] != 0xFF {
            return Ok(None); // 不正なマーカー — 安全側に倒して None
        }

        let marker_type = marker[1];

        // パディング 0xFF をスキップ
        if marker_type == 0xFF {
            // 次のバイトを再読み込み（ループ先頭に戻る）
            file.seek(SeekFrom::Current(-1))
                .map_err(|e| format!("Failed to seek back for padding: {e}"))?;
            continue;
        }

        // スタンドアロンマーカー（長さフィールドなし）: RST0-RST7, TEM
        if marker_type == 0x00
            || (0xD0..=0xD7).contains(&marker_type)
            || marker_type == 0x01
        {
            continue;
        }

        // SOS (0xDA) / EOI (0xD9) — XMP はこれより前にあるので打ち切り
        if marker_type == 0xDA || marker_type == 0xD9 {
            return Ok(None);
        }

        // セグメント長 (2 bytes, big-endian, 自身を含む)
        let mut len_bytes = [0u8; 2];
        file.read_exact(&mut len_bytes)
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
            file.read_exact(&mut prefix_buf)
                .map_err(|e| format!("Failed to read APP1 prefix: {e}"))?;

            if prefix_buf == XMP_PREFIX {
                // XMP データ本体だけ読み取り
                let xmp_len = data_len - XMP_PREFIX.len();
                let mut xmp_buf = vec![0u8; xmp_len];
                file.read_exact(&mut xmp_buf)
                    .map_err(|e| format!("Failed to read XMP data: {e}"))?;

                let xml_text = match String::from_utf8(xmp_buf) {
                    Ok(s) => s,
                    Err(_) => return Ok(None), // 不正な UTF-8 — XMP なし扱い
                };
                return Ok(parse_vrc_xmp(&xml_text));
            }

            // XMP ではない APP1 — 残りをスキップ
            let remaining = (data_len - XMP_PREFIX.len()) as i64;
            file.seek(SeekFrom::Current(remaining))
                .map_err(|e| format!("Failed to skip non-XMP APP1: {e}"))?;
        } else {
            // APP1 以外のセグメント — スキップ
            file.seek(SeekFrom::Current(data_len as i64))
                .map_err(|e| format!("Failed to skip segment: {e}"))?;
        }
    }
}

/// PNG ファイルから部分読み込みで XMP を抽出する。
///
/// シグネチャの後、チャンクヘッダー (8B: length + type) を順に走査する。
/// iTXt + keyword "XML:com.adobe.xmp" が見つかったらそのチャンクだけ読む。
/// IDAT / IEND に到達したら打ち切り（VRChat は XMP を IDAT の前に配置する）。
///
/// file は先頭にシーク済みであること（detect_image_format_from_file が先頭を読む）。
fn read_xmp_from_png_stream(file: &mut File) -> Result<Option<VrcXmpMetadata>, String> {
    // PNG シグネチャ (8 bytes) は detect で読み済み → オフセット 8 から開始
    file.seek(SeekFrom::Start(8))
        .map_err(|e| format!("Failed to seek past PNG signature: {e}"))?;

    const XMP_KEYWORD: &[u8] = b"XML:com.adobe.xmp";

    loop {
        // チャンクヘッダー: length (4B) + type (4B)
        let mut header = [0u8; 8];
        if file.read_exact(&mut header).is_err() {
            return Ok(None); // EOF — XMP なし
        }

        let chunk_len =
            u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as usize;
        let chunk_type = [header[4], header[5], header[6], header[7]];

        // IDAT / IEND — XMP は IDAT の前に配置されるため打ち切り
        if chunk_type == *b"IDAT" || chunk_type == *b"IEND" {
            return Ok(None);
        }

        if chunk_type == *b"iTXt" {
            // iTXt チャンクデータを読み取り
            let mut chunk_data = vec![0u8; chunk_len];
            file.read_exact(&mut chunk_data)
                .map_err(|e| format!("Failed to read iTXt chunk: {e}"))?;

            // CRC (4B) をスキップ
            file.seek(SeekFrom::Current(4))
                .map_err(|e| format!("Failed to skip CRC: {e}"))?;

            // keyword チェック (null-terminated)
            let keyword_end = match chunk_data.iter().position(|&b| b == 0) {
                Some(pos) => pos,
                None => continue, // 不正な iTXt — 次のチャンクへ
            };

            if keyword_end > chunk_data.len()
                || &chunk_data[..keyword_end] != XMP_KEYWORD
            {
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
            file.seek(SeekFrom::Current(skip))
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
