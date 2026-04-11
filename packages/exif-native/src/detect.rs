/// バッファの先頭バイト（マジックバイト）から画像フォーマットを判定する。
///
/// exiftool はファイル拡張子と実際のフォーマットが一致しないと書き込みに失敗するため、
/// 正しいフォーマットを判定する必要がある。
pub enum ImageFormat {
    Jpeg,
    Png,
    Unknown,
}

const JPEG_MAGIC: &[u8] = &[0xFF, 0xD8, 0xFF];
const PNG_MAGIC: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

pub fn detect_image_format(data: &[u8]) -> ImageFormat {
    if data.len() >= JPEG_MAGIC.len() && data[..JPEG_MAGIC.len()] == *JPEG_MAGIC {
        ImageFormat::Jpeg
    } else if data.len() >= PNG_MAGIC.len() && data[..PNG_MAGIC.len()] == *PNG_MAGIC {
        ImageFormat::Png
    } else {
        ImageFormat::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_jpeg() {
        let data = [0xFF, 0xD8, 0xFF, 0xE0, 0x00];
        assert!(matches!(detect_image_format(&data), ImageFormat::Jpeg));
    }

    #[test]
    fn detects_png() {
        let data = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00];
        assert!(matches!(detect_image_format(&data), ImageFormat::Png));
    }

    #[test]
    fn detects_unknown() {
        let data = [0x00, 0x01, 0x02];
        assert!(matches!(detect_image_format(&data), ImageFormat::Unknown));
    }

    #[test]
    fn empty_buffer_is_unknown() {
        assert!(matches!(detect_image_format(&[]), ImageFormat::Unknown));
    }
}
