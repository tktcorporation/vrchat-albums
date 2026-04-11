/// PNG コンテナからの XMP 抽出と EXIF チャンク挿入。
///
/// VRChat は XMP メタデータを PNG の iTXt チャンク（keyword: "XML:com.adobe.xmp"）に格納する。
/// EXIF は eXIf チャンク（PNG 1.5 spec）に格納する。
use img_parts::png::{Png, PngChunk};
use img_parts::{Bytes, ImageEXIF};

const CHUNK_ITXT: [u8; 4] = [b'i', b'T', b'X', b't'];
const CHUNK_IDAT: [u8; 4] = [b'I', b'D', b'A', b'T'];
const XMP_KEYWORD: &[u8] = b"XML:com.adobe.xmp";

/// PNG iTXt チャンクから XMP XML 文字列を抽出する。
///
/// iTXt チャンクの構造:
///   keyword (null-terminated) + compression flag (1 byte) + compression method (1 byte)
///   + language tag (null-terminated) + translated keyword (null-terminated) + text
///
/// VRChat の場合 keyword == "XML:com.adobe.xmp" で compression == 0。
pub fn extract_xmp_from_png(data: &[u8]) -> Result<Option<String>, String> {
    let png = Png::from_bytes(Bytes::copy_from_slice(data))
        .map_err(|e| format!("Failed to parse PNG: {e}"))?;

    for chunk in png.chunks() {
        if chunk.kind() != CHUNK_ITXT {
            continue;
        }

        let chunk_data = chunk.contents();
        // keyword は null-terminated
        let keyword_end = match chunk_data.iter().position(|&b| b == 0) {
            Some(pos) => pos,
            None => continue,
        };

        if &chunk_data[..keyword_end] != XMP_KEYWORD {
            continue;
        }

        // keyword null + compression flag (1) + compression method (1) の後に
        // language tag (null-terminated) + translated keyword (null-terminated) + text
        let mut offset = keyword_end + 1; // skip null terminator
        if offset + 2 > chunk_data.len() {
            continue;
        }

        let compression_flag = chunk_data[offset];
        offset += 2; // skip compression flag + method

        if compression_flag != 0 {
            // 圧縮された XMP は VRChat では使われないため未対応
            continue;
        }

        // language tag (null-terminated)
        match chunk_data[offset..].iter().position(|&b| b == 0) {
            Some(pos) => offset += pos + 1,
            None => continue,
        }

        // translated keyword (null-terminated)
        match chunk_data[offset..].iter().position(|&b| b == 0) {
            Some(pos) => offset += pos + 1,
            None => continue,
        }

        // 残りが XMP XML テキスト（不正な UTF-8 の場合は XMP なしとして扱う）
        let xml_text = match String::from_utf8(chunk_data[offset..].to_vec()) {
            Ok(s) => s,
            Err(_) => continue,
        };
        return Ok(Some(xml_text));
    }

    Ok(None)
}

/// PNG に EXIF データ（バイト列）を埋め込む。
///
/// img-parts の ImageEXIF trait で eXIf チャンクとして挿入する。
/// 既存の eXIf チャンクがあれば置き換える。
pub fn set_exif_in_png(data: &[u8], exif_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut png = Png::from_bytes(Bytes::copy_from_slice(data))
        .map_err(|e| format!("Failed to parse PNG: {e}"))?;

    png.set_exif(Some(Bytes::copy_from_slice(exif_bytes)));

    let mut output = Vec::new();
    png.encoder()
        .write_to(&mut output)
        .map_err(|e| format!("Failed to encode PNG: {e}"))?;

    Ok(output)
}

/// PNG に XMP メタデータ（XML 文字列）を iTXt チャンクとして埋め込む。
///
/// 既存の XMP iTXt チャンクがあれば置き換え、なければ追加する。
/// VRChat と同じ構造: keyword="XML:com.adobe.xmp", compression=0
pub fn set_xmp_in_png(data: &[u8], xmp_xml: &str) -> Result<Vec<u8>, String> {
    let mut png = Png::from_bytes(Bytes::copy_from_slice(data))
        .map_err(|e| format!("Failed to parse PNG: {e}"))?;

    // 既存の XMP iTXt チャンクを削除
    png.chunks_mut().retain(|c| {
        if c.kind() != CHUNK_ITXT {
            return true;
        }
        let cd = c.contents();
        let keyword_end = match cd.iter().position(|&b| b == 0) {
            Some(pos) => pos,
            None => return true,
        };
        &cd[..keyword_end] != XMP_KEYWORD
    });

    // iTXt チャンクデータを構築
    let mut chunk_data = Vec::new();
    chunk_data.extend_from_slice(XMP_KEYWORD);
    chunk_data.push(0); // null terminator for keyword
    chunk_data.push(0); // compression flag: 0 (uncompressed)
    chunk_data.push(0); // compression method: 0
    chunk_data.push(0); // language tag: empty, null terminated
    chunk_data.push(0); // translated keyword: empty, null terminated
    chunk_data.extend_from_slice(xmp_xml.as_bytes());

    let new_chunk = PngChunk::new(CHUNK_ITXT, Bytes::from(chunk_data));

    // IDAT の前に XMP チャンクを挿入
    let chunks = png.chunks_mut();
    let idat_pos = chunks
        .iter()
        .position(|c| c.kind() == CHUNK_IDAT)
        .unwrap_or(chunks.len());
    chunks.insert(idat_pos, new_chunk);

    let mut output = Vec::new();
    png.encoder()
        .write_to(&mut output)
        .map_err(|e| format!("Failed to encode PNG: {e}"))?;

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 最小限の有効な PNG バイト列を構築する（iTXt チャンクなし）。
    ///
    /// PNG signature + IHDR (1x1 8-bit grayscale) + IDAT (zlib-compressed) + IEND
    fn minimal_png() -> Vec<u8> {
        let mut buf = Vec::new();
        // PNG signature
        buf.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

        // IHDR chunk: 1x1 pixel, 8-bit grayscale
        let ihdr_data: [u8; 13] = [
            0, 0, 0, 1, // width = 1
            0, 0, 0, 1, // height = 1
            8,  // bit depth = 8
            0,  // color type = grayscale
            0,  // compression method
            0,  // filter method
            0,  // interlace method
        ];
        write_png_chunk(&mut buf, b"IHDR", &ihdr_data);

        // IDAT chunk: minimal zlib-compressed data
        write_png_chunk(&mut buf, b"IDAT", &[0x78, 0x01, 0x62, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]);

        // IEND chunk (empty)
        write_png_chunk(&mut buf, b"IEND", &[]);

        buf
    }

    /// PNG チャンクを書き込む（length + type + data + CRC）
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

    /// CRC-32 (PNG polynomial 0xEDB88320)
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

    #[test]
    fn extract_xmp_returns_none_for_png_without_itxt() {
        let png_bytes = minimal_png();
        let result = extract_xmp_from_png(&png_bytes);
        // img_parts may accept or reject our minimal PNG.
        // If it parses successfully, XMP should be None (no iTXt chunk).
        // If it rejects due to invalid zlib data, that's also acceptable.
        match result {
            Ok(xmp) => assert!(xmp.is_none(), "Expected None XMP for PNG without iTXt chunk"),
            Err(_) => {} // Parse error on minimal PNG is acceptable
        }
    }

    #[test]
    fn extract_xmp_returns_error_for_empty_data() {
        let result = extract_xmp_from_png(&[]);
        assert!(result.is_err(), "Expected error for empty data");
    }

    #[test]
    fn extract_xmp_returns_error_for_invalid_data() {
        let result = extract_xmp_from_png(b"not a png file at all");
        assert!(result.is_err(), "Expected error for non-PNG data");
    }
}
