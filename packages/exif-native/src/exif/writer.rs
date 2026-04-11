/// EXIF IFD バイト列の構築。
///
/// World Join Image に埋め込む 7 フィールドのみをサポート:
///   IFD0: ImageDescription (0x010E)
///   Exif SubIFD: DateTimeOriginal (0x9003), DateTimeDigitized (0x9004),
///                OffsetTime (0x9010), OffsetTimeOriginal (0x9011), OffsetTimeDigitized (0x9012)
///
/// TIFF 構造（リトルエンディアン）:
///   [Byte Order "II"] [Magic 0x002A] [IFD0 Offset]
///   [IFD0 entries...] [Next IFD offset = 0]
///   [Exif SubIFD entries...] [Next IFD offset = 0]
///   [Data area: 文字列値]

/// EXIF 書き込みパラメータ
pub struct ExifWriteParams {
    /// 画像の説明（ワールド名など）
    pub description: String,
    /// 撮影日時 "yyyy:MM:dd HH:mm:ss" 形式
    pub date_time_original: String,
    /// タイムゾーンオフセット "+09:00" 形式
    pub timezone_offset: String,
}

// EXIF タグ ID
const TAG_IMAGE_DESCRIPTION: u16 = 0x010E;
const TAG_EXIF_IFD_POINTER: u16 = 0x8769;
const TAG_DATE_TIME_ORIGINAL: u16 = 0x9003;
const TAG_DATE_TIME_DIGITIZED: u16 = 0x9004;
const TAG_OFFSET_TIME: u16 = 0x9010;
const TAG_OFFSET_TIME_ORIGINAL: u16 = 0x9011;
const TAG_OFFSET_TIME_DIGITIZED: u16 = 0x9012;

// EXIF データ型
const TYPE_ASCII: u16 = 2;
const TYPE_LONG: u16 = 4;

/// EXIF IFD バイト列を構築する。
///
/// img-parts の set_exif() に渡す形式:
/// TIFF ヘッダー（"II" + 0x002A + offset）から始まるバイト列。
/// "Exif\0\0" プレフィックスは img-parts が付加するため含めない。
pub fn build_exif_bytes(params: &ExifWriteParams) -> Vec<u8> {
    let mut buf = Vec::with_capacity(512);

    // --- TIFF ヘッダー (8 bytes) ---
    buf.extend_from_slice(b"II"); // リトルエンディアン
    write_u16(&mut buf, 0x002A); // TIFF magic
    write_u32(&mut buf, 8); // IFD0 のオフセット = 8 (ヘッダー直後)

    // --- IFD0 ---
    // IFD0 には 2 エントリ: ImageDescription + ExifIFDPointer
    let ifd0_entry_count: u16 = 2;
    let ifd0_size = 2 + (ifd0_entry_count as usize * 12) + 4; // count + entries + next_ifd

    // Exif SubIFD のオフセット: IFD0 の直後
    let exif_ifd_offset = 8 + ifd0_size;

    // Exif SubIFD には 5 エントリ
    let exif_ifd_entry_count: u16 = 5;
    let exif_ifd_size = 2 + (exif_ifd_entry_count as usize * 12) + 4;

    // データ領域のオフセット: Exif SubIFD の直後
    let data_area_offset = exif_ifd_offset + exif_ifd_size;

    // データ領域に書く文字列を準備
    // 各文字列は null-terminated ASCII
    let desc_bytes = null_terminated(&params.description);
    let datetime_bytes = null_terminated(&params.date_time_original);
    let tz_bytes = null_terminated(&params.timezone_offset);

    // データ領域内の各文字列のオフセットを計算
    let desc_offset = data_area_offset;
    let datetime_orig_offset = desc_offset + desc_bytes.len();
    let datetime_digi_offset = datetime_orig_offset + datetime_bytes.len();
    let tz_offset = datetime_digi_offset + datetime_bytes.len();
    let tz_orig_offset = tz_offset + tz_bytes.len();
    let tz_digi_offset = tz_orig_offset + tz_bytes.len();

    // --- IFD0 エントリ書き込み ---
    write_u16(&mut buf, ifd0_entry_count);

    // ImageDescription
    write_ifd_entry(
        &mut buf,
        TAG_IMAGE_DESCRIPTION,
        TYPE_ASCII,
        desc_bytes.len() as u32,
        desc_offset as u32,
    );

    // ExifIFDPointer (IFD0 から Exif SubIFD へのポインタ)
    write_ifd_entry(
        &mut buf,
        TAG_EXIF_IFD_POINTER,
        TYPE_LONG,
        1,
        exif_ifd_offset as u32,
    );

    // Next IFD offset = 0 (IFD0 の次は無い)
    write_u32(&mut buf, 0);

    // --- Exif SubIFD エントリ書き込み ---
    write_u16(&mut buf, exif_ifd_entry_count);

    // DateTimeOriginal
    write_ifd_entry(
        &mut buf,
        TAG_DATE_TIME_ORIGINAL,
        TYPE_ASCII,
        datetime_bytes.len() as u32,
        datetime_orig_offset as u32,
    );

    // DateTimeDigitized
    write_ifd_entry(
        &mut buf,
        TAG_DATE_TIME_DIGITIZED,
        TYPE_ASCII,
        datetime_bytes.len() as u32,
        datetime_digi_offset as u32,
    );

    // OffsetTime
    write_ifd_entry_inline_or_offset(
        &mut buf,
        TAG_OFFSET_TIME,
        TYPE_ASCII,
        &tz_bytes,
        tz_offset as u32,
    );

    // OffsetTimeOriginal
    write_ifd_entry_inline_or_offset(
        &mut buf,
        TAG_OFFSET_TIME_ORIGINAL,
        TYPE_ASCII,
        &tz_bytes,
        tz_orig_offset as u32,
    );

    // OffsetTimeDigitized
    write_ifd_entry_inline_or_offset(
        &mut buf,
        TAG_OFFSET_TIME_DIGITIZED,
        TYPE_ASCII,
        &tz_bytes,
        tz_digi_offset as u32,
    );

    // Next IFD offset = 0
    write_u32(&mut buf, 0);

    // --- データ領域 ---
    buf.extend_from_slice(&desc_bytes);
    buf.extend_from_slice(&datetime_bytes); // DateTimeOriginal
    buf.extend_from_slice(&datetime_bytes); // DateTimeDigitized (同じ値)
    buf.extend_from_slice(&tz_bytes); // OffsetTime
    buf.extend_from_slice(&tz_bytes); // OffsetTimeOriginal
    buf.extend_from_slice(&tz_bytes); // OffsetTimeDigitized

    buf
}

/// IFD エントリ (12 bytes) を書き込む。値はオフセット参照。
fn write_ifd_entry(buf: &mut Vec<u8>, tag: u16, data_type: u16, count: u32, value_offset: u32) {
    write_u16(buf, tag);
    write_u16(buf, data_type);
    write_u32(buf, count);
    write_u32(buf, value_offset);
}

/// IFD エントリを書き込む。4バイト以下ならインライン、超えたらオフセット参照。
///
/// TIFF 仕様: データが 4 バイト以下なら IFD エントリの value/offset フィールドに
/// 直接格納する（インライン）。超える場合はデータ領域へのオフセットを書く。
fn write_ifd_entry_inline_or_offset(
    buf: &mut Vec<u8>,
    tag: u16,
    data_type: u16,
    data: &[u8],
    offset: u32,
) {
    write_u16(buf, tag);
    write_u16(buf, data_type);
    write_u32(buf, data.len() as u32);

    if data.len() <= 4 {
        // インライン: 4 バイトにパディング
        let mut inline = [0u8; 4];
        inline[..data.len()].copy_from_slice(data);
        buf.extend_from_slice(&inline);
    } else {
        write_u32(buf, offset);
    }
}

fn write_u16(buf: &mut Vec<u8>, val: u16) {
    buf.extend_from_slice(&val.to_le_bytes());
}

fn write_u32(buf: &mut Vec<u8>, val: u32) {
    buf.extend_from_slice(&val.to_le_bytes());
}

/// 文字列を null-terminated バイト列に変換する
fn null_terminated(s: &str) -> Vec<u8> {
    let mut bytes = s.as_bytes().to_vec();
    bytes.push(0);
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_valid_tiff_header() {
        let params = ExifWriteParams {
            description: "Test".to_string(),
            date_time_original: "2024:01:01 12:00:00".to_string(),
            timezone_offset: "+09:00".to_string(),
        };

        let bytes = build_exif_bytes(&params);

        // TIFF ヘッダー: "II" (little-endian)
        assert_eq!(&bytes[0..2], b"II");
        // TIFF magic: 0x002A
        assert_eq!(u16::from_le_bytes([bytes[2], bytes[3]]), 0x002A);
        // IFD0 offset: 8
        assert_eq!(
            u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]),
            8
        );
    }

    #[test]
    fn ifd0_has_correct_entry_count() {
        let params = ExifWriteParams {
            description: "Test".to_string(),
            date_time_original: "2024:01:01 12:00:00".to_string(),
            timezone_offset: "+09:00".to_string(),
        };

        let bytes = build_exif_bytes(&params);

        // IFD0 entry count at offset 8
        let count = u16::from_le_bytes([bytes[8], bytes[9]]);
        assert_eq!(count, 2); // ImageDescription + ExifIFDPointer
    }

    #[test]
    fn description_is_stored_correctly() {
        let params = ExifWriteParams {
            description: "Beautiful World".to_string(),
            date_time_original: "2024:06:15 18:30:00".to_string(),
            timezone_offset: "+09:00".to_string(),
        };

        let bytes = build_exif_bytes(&params);

        // ImageDescription の値がデータ領域に含まれるか
        let desc_with_null = b"Beautiful World\0";
        let found = bytes
            .windows(desc_with_null.len())
            .any(|w| w == desc_with_null);
        assert!(found, "Description not found in EXIF bytes");
    }

    #[test]
    fn datetime_is_stored_correctly() {
        let params = ExifWriteParams {
            description: "Test".to_string(),
            date_time_original: "2024:12:31 23:59:59".to_string(),
            timezone_offset: "-05:00".to_string(),
        };

        let bytes = build_exif_bytes(&params);

        let datetime_with_null = b"2024:12:31 23:59:59\0";
        let found = bytes
            .windows(datetime_with_null.len())
            .any(|w| w == datetime_with_null);
        assert!(found, "DateTime not found in EXIF bytes");

        let tz_with_null = b"-05:00\0";
        let found_tz = bytes.windows(tz_with_null.len()).any(|w| w == tz_with_null);
        assert!(found_tz, "Timezone offset not found in EXIF bytes");
    }
}
