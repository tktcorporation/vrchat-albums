/// JPEG コンテナからの XMP 抽出と EXIF セグメント挿入。
///
/// XMP は APP1 セグメント内に "http://ns.adobe.com/xap/1.0/\0" プレフィックス付きで格納される。
/// EXIF は APP1 セグメント内に "Exif\0\0" プレフィックス付きで格納される。
use img_parts::jpeg::{Jpeg, JpegSegment};
use img_parts::{Bytes, ImageEXIF};

/// XMP が格納される APP1 セグメントのプレフィックス
const XMP_APP1_PREFIX: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";

/// JPEG APP1 セグメントから XMP XML 文字列を抽出する。
pub fn extract_xmp_from_jpeg(data: &[u8]) -> Result<Option<String>, String> {
    let jpeg = Jpeg::from_bytes(Bytes::copy_from_slice(data))
        .map_err(|e| format!("Failed to parse JPEG: {e}"))?;

    for segment in jpeg.segments() {
        // APP1 marker = 0xE1
        if segment.marker() != 0xE1 {
            continue;
        }

        let contents = segment.contents();
        if contents.len() <= XMP_APP1_PREFIX.len() {
            continue;
        }

        if !contents.starts_with(XMP_APP1_PREFIX) {
            continue;
        }

        let xml_bytes = &contents[XMP_APP1_PREFIX.len()..];
        let xml_text = String::from_utf8_lossy(xml_bytes).to_string();
        return Ok(Some(xml_text));
    }

    Ok(None)
}

/// JPEG に EXIF データ（バイト列）を埋め込む。
///
/// img-parts の ImageEXIF trait で APP1 EXIF セグメントとして挿入する。
/// 既存の EXIF セグメントがあれば置き換える。
pub fn set_exif_in_jpeg(data: &[u8], exif_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut jpeg = Jpeg::from_bytes(Bytes::copy_from_slice(data))
        .map_err(|e| format!("Failed to parse JPEG: {e}"))?;

    jpeg.set_exif(Some(Bytes::copy_from_slice(exif_bytes)));

    let mut output = Vec::new();
    jpeg.encoder()
        .write_to(&mut output)
        .map_err(|e| format!("Failed to encode JPEG: {e}"))?;

    Ok(output)
}

/// JPEG に XMP メタデータ（XML 文字列）を APP1 セグメントとして埋め込む。
///
/// 既存の XMP APP1 セグメントがあれば置き換え、なければ追加する。
/// XMP APP1 は "http://ns.adobe.com/xap/1.0/\0" プレフィックス + XML 本文。
pub fn set_xmp_in_jpeg(data: &[u8], xmp_xml: &str) -> Result<Vec<u8>, String> {
    let mut jpeg = Jpeg::from_bytes(Bytes::copy_from_slice(data))
        .map_err(|e| format!("Failed to parse JPEG: {e}"))?;

    // 既存の XMP APP1 セグメントを削除
    jpeg.segments_mut().retain(|s| {
        if s.marker() != 0xE1 {
            return true;
        }
        !s.contents().starts_with(XMP_APP1_PREFIX)
    });

    // 新しい XMP APP1 セグメントを構築
    let mut contents = Vec::with_capacity(XMP_APP1_PREFIX.len() + xmp_xml.len());
    contents.extend_from_slice(XMP_APP1_PREFIX);
    contents.extend_from_slice(xmp_xml.as_bytes());

    let segment = JpegSegment::new_with_contents(0xE1, Bytes::from(contents));

    // EXIF APP1 の後、SOS の前に挿入
    let insert_pos = jpeg
        .segments()
        .iter()
        .position(|s| s.marker() == 0xDA) // SOS marker
        .unwrap_or(jpeg.segments().len());
    jpeg.segments_mut().insert(insert_pos, segment);

    let mut output = Vec::new();
    jpeg.encoder()
        .write_to(&mut output)
        .map_err(|e| format!("Failed to encode JPEG: {e}"))?;

    Ok(output)
}
