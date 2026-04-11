/// EXIF IFD バイト列の構築。
///
/// World Join Image に埋め込む 6 フィールドをサポート:
///   IFD0: ImageDescription (0x010E)
///   Exif SubIFD: DateTimeOriginal (0x9003), DateTimeDigitized (0x9004),
///                OffsetTimeOriginal (0x9011), OffsetTimeDigitized (0x9012)
///
/// 注: OffsetTime (0x9010) は IFD0 に DateTime (0x0132) がないため書き込まない。
///      OffsetTime は DateTime に対応するオフセットなので、対になるタグがなければ不要。
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
    /// 撮影日時 "yyyy:MM:dd HH:mm:ss" または "yyyy-MM-dd HH:mm:ss" 形式
    pub date_time_original: String,
    /// タイムゾーンオフセット "+HH:MM" / "-HH:MM" / "+00:00" 形式
    pub timezone_offset: String,
}

// EXIF タグ ID
const TAG_IMAGE_DESCRIPTION: u16 = 0x010E;
const TAG_EXIF_IFD_POINTER: u16 = 0x8769;
const TAG_DATE_TIME_ORIGINAL: u16 = 0x9003;
const TAG_DATE_TIME_DIGITIZED: u16 = 0x9004;
/// OffsetTime タグ ID。対になる DateTime (0x0132) を IFD0 に書き込んでいないため
/// 現在は使用しないが、将来 DateTime を追加する際に必要になるため定義を残す。
#[allow(dead_code)]
const TAG_OFFSET_TIME: u16 = 0x9010;
const TAG_OFFSET_TIME_ORIGINAL: u16 = 0x9011;
const TAG_OFFSET_TIME_DIGITIZED: u16 = 0x9012;

// EXIF データ型
const TYPE_ASCII: u16 = 2;
const TYPE_LONG: u16 = 4;

// ============================================================================
// バリデーション
// ============================================================================

/// NUL バイトが含まれていないことを検証する。
///
/// EXIF ASCII フィールドは NUL 終端するため、データ内に NUL があると
/// フィールドが途中で切り詰められ、不正な EXIF が生成される。
fn validate_no_nul(s: &str, field_name: &str) -> Result<(), String> {
    if s.contains('\0') {
        return Err(format!(
            "Invalid {field_name}: must not contain NUL bytes"
        ));
    }
    Ok(())
}

/// 日時フォーマットを検証する。
///
/// EXIF DateTimeOriginal は "YYYY:MM:DD HH:MM:SS" が標準だが、
/// electronUtilController が "YYYY-MM-DD HH:MM:SS"（ハイフン区切り）で呼び出すため
/// 両方を許容する。共通パターン: 4桁-区切り-2桁-区切り-2桁 空白 2桁:2桁:2桁
fn validate_datetime(s: &str) -> Result<(), String> {
    let bytes = s.as_bytes();
    if bytes.len() != 19 {
        return Err(format!(
            "Invalid date_time_original: expected 19 chars (YYYY:MM:DD HH:MM:SS), got {} chars: {s:?}",
            bytes.len()
        ));
    }
    // YYYY
    if !bytes[0..4].iter().all(|b| b.is_ascii_digit()) {
        return Err(format!("Invalid date_time_original: bad year: {s:?}"));
    }
    // separator (: or -)
    if bytes[4] != b':' && bytes[4] != b'-' {
        return Err(format!(
            "Invalid date_time_original: expected ':' or '-' at position 4: {s:?}"
        ));
    }
    // MM
    if !bytes[5..7].iter().all(|b| b.is_ascii_digit()) {
        return Err(format!("Invalid date_time_original: bad month: {s:?}"));
    }
    // separator
    if bytes[7] != bytes[4] {
        return Err(format!(
            "Invalid date_time_original: inconsistent date separators: {s:?}"
        ));
    }
    // DD
    if !bytes[8..10].iter().all(|b| b.is_ascii_digit()) {
        return Err(format!("Invalid date_time_original: bad day: {s:?}"));
    }
    // space
    if bytes[10] != b' ' {
        return Err(format!(
            "Invalid date_time_original: expected space at position 10: {s:?}"
        ));
    }
    // HH:MM:SS
    if !bytes[11..13].iter().all(|b| b.is_ascii_digit())
        || bytes[13] != b':'
        || !bytes[14..16].iter().all(|b| b.is_ascii_digit())
        || bytes[16] != b':'
        || !bytes[17..19].iter().all(|b| b.is_ascii_digit())
    {
        return Err(format!(
            "Invalid date_time_original: bad time portion: {s:?}"
        ));
    }
    Ok(())
}

/// タイムゾーンオフセットのフォーマットを検証する。
///
/// "+HH:MM" / "-HH:MM" / "+00:00" 形式のみ許容。
fn validate_timezone(s: &str) -> Result<(), String> {
    let bytes = s.as_bytes();
    if bytes.len() != 6 {
        return Err(format!(
            "Invalid timezone_offset: expected 6 chars (+HH:MM), got {} chars: {s:?}",
            bytes.len()
        ));
    }
    if bytes[0] != b'+' && bytes[0] != b'-' {
        return Err(format!(
            "Invalid timezone_offset: must start with '+' or '-': {s:?}"
        ));
    }
    if !bytes[1..3].iter().all(|b| b.is_ascii_digit())
        || bytes[3] != b':'
        || !bytes[4..6].iter().all(|b| b.is_ascii_digit())
    {
        return Err(format!(
            "Invalid timezone_offset: expected +HH:MM format: {s:?}"
        ));
    }
    Ok(())
}

// ============================================================================
// IFD 構築
// ============================================================================

/// EXIF IFD バイト列を構築する。
///
/// img-parts の set_exif() に渡す形式:
/// TIFF ヘッダー（"II" + 0x002A + offset）から始まるバイト列。
/// "Exif\0\0" プレフィックスは img-parts が付加するため含めない。
///
/// 入力バリデーション:
/// - NUL バイトを含むフィールドは拒否（EXIF ASCII 切り詰め防止）
/// - 日時フォーマット "YYYY:MM:DD HH:MM:SS" or "YYYY-MM-DD HH:MM:SS"
/// - タイムゾーン "+HH:MM" / "-HH:MM"
pub fn build_exif_bytes(params: &ExifWriteParams) -> Result<Vec<u8>, String> {
    // --- 入力バリデーション ---
    validate_no_nul(&params.description, "description")?;
    validate_no_nul(&params.date_time_original, "date_time_original")?;
    validate_no_nul(&params.timezone_offset, "timezone_offset")?;
    validate_datetime(&params.date_time_original)?;
    validate_timezone(&params.timezone_offset)?;

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

    // Exif SubIFD には 4 エントリ（OffsetTime は DateTime なしのため除外）
    let exif_ifd_entry_count: u16 = 4;
    let exif_ifd_size = 2 + (exif_ifd_entry_count as usize * 12) + 4;

    // データ領域のオフセット: Exif SubIFD の直後
    let data_area_offset = exif_ifd_offset + exif_ifd_size;

    // データ領域に書く文字列を準備（バリデーション済みなので NUL 挿入は安全）
    let desc_bytes = null_terminated(&params.description);
    let datetime_bytes = null_terminated(&params.date_time_original);
    let tz_bytes = null_terminated(&params.timezone_offset);

    // データ領域内の各文字列のオフセットを計算
    let desc_offset = data_area_offset;
    let datetime_orig_offset = desc_offset + desc_bytes.len();
    let datetime_digi_offset = datetime_orig_offset + datetime_bytes.len();
    let tz_orig_offset = datetime_digi_offset + datetime_bytes.len();
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

    // OffsetTimeOriginal
    write_ifd_entry(
        &mut buf,
        TAG_OFFSET_TIME_ORIGINAL,
        TYPE_ASCII,
        tz_bytes.len() as u32,
        tz_orig_offset as u32,
    );

    // OffsetTimeDigitized
    write_ifd_entry(
        &mut buf,
        TAG_OFFSET_TIME_DIGITIZED,
        TYPE_ASCII,
        tz_bytes.len() as u32,
        tz_digi_offset as u32,
    );

    // Next IFD offset = 0
    write_u32(&mut buf, 0);

    // --- データ領域 ---
    buf.extend_from_slice(&desc_bytes);
    buf.extend_from_slice(&datetime_bytes); // DateTimeOriginal
    buf.extend_from_slice(&datetime_bytes); // DateTimeDigitized (同じ値)
    buf.extend_from_slice(&tz_bytes); // OffsetTimeOriginal
    buf.extend_from_slice(&tz_bytes); // OffsetTimeDigitized

    let total_size = buf.len();
    if total_size > u32::MAX as usize {
        return Err("EXIF data too large: exceeds u32 offset limit".to_string());
    }

    Ok(buf)
}

/// IFD エントリ (12 bytes) を書き込む。値はオフセット参照。
fn write_ifd_entry(buf: &mut Vec<u8>, tag: u16, data_type: u16, count: u32, value_offset: u32) {
    write_u16(buf, tag);
    write_u16(buf, data_type);
    write_u32(buf, count);
    write_u32(buf, value_offset);
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

// ============================================================================
// テスト用ヘルパー: IFD パーサー
// ============================================================================

#[cfg(test)]
mod test_helpers {
    /// TIFF IFD エントリをパースする
    pub struct IfdEntry {
        pub tag: u16,
        pub data_type: u16,
        pub count: u32,
        pub value_offset: u32,
    }

    /// バイト列の指定オフセットから IFD エントリを読む
    pub fn read_ifd_entry(bytes: &[u8], offset: usize) -> IfdEntry {
        IfdEntry {
            tag: u16::from_le_bytes([bytes[offset], bytes[offset + 1]]),
            data_type: u16::from_le_bytes([bytes[offset + 2], bytes[offset + 3]]),
            count: u32::from_le_bytes([
                bytes[offset + 4],
                bytes[offset + 5],
                bytes[offset + 6],
                bytes[offset + 7],
            ]),
            value_offset: u32::from_le_bytes([
                bytes[offset + 8],
                bytes[offset + 9],
                bytes[offset + 10],
                bytes[offset + 11],
            ]),
        }
    }

    /// IFD エントリ群から指定タグを検索
    pub fn find_entry(bytes: &[u8], ifd_offset: usize, tag: u16) -> Option<IfdEntry> {
        let count = u16::from_le_bytes([bytes[ifd_offset], bytes[ifd_offset + 1]]) as usize;
        for i in 0..count {
            let entry = read_ifd_entry(bytes, ifd_offset + 2 + i * 12);
            if entry.tag == tag {
                return Some(entry);
            }
        }
        None
    }

    /// ASCII フィールドの null-terminated 文字列をデータ領域から読む
    pub fn read_ascii(bytes: &[u8], offset: u32, count: u32) -> String {
        let start = offset as usize;
        let end = start + count as usize - 1; // null terminator を除く
        String::from_utf8_lossy(&bytes[start..end]).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_helpers::*;

    fn default_params() -> ExifWriteParams {
        ExifWriteParams {
            description: "Beautiful World".to_string(),
            date_time_original: "2024:06:15 18:30:00".to_string(),
            timezone_offset: "+09:00".to_string(),
        }
    }

    // ========================================================================
    // TIFF ヘッダー
    // ========================================================================

    #[test]
    fn builds_valid_tiff_header() {
        let bytes = build_exif_bytes(&default_params()).unwrap();

        assert_eq!(&bytes[0..2], b"II");
        assert_eq!(u16::from_le_bytes([bytes[2], bytes[3]]), 0x002A);
        assert_eq!(
            u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]),
            8
        );
    }

    // ========================================================================
    // IFD0 構造
    // ========================================================================

    #[test]
    fn ifd0_has_correct_entry_count_and_tags() {
        let bytes = build_exif_bytes(&default_params()).unwrap();
        let ifd0_offset = 8;

        // エントリ数
        let count = u16::from_le_bytes([bytes[ifd0_offset], bytes[ifd0_offset + 1]]);
        assert_eq!(count, 2);

        // ImageDescription (0x010E)
        let desc_entry = find_entry(&bytes, ifd0_offset, TAG_IMAGE_DESCRIPTION)
            .expect("ImageDescription entry not found in IFD0");
        assert_eq!(desc_entry.data_type, TYPE_ASCII);

        // ExifIFDPointer (0x8769)
        let ptr_entry = find_entry(&bytes, ifd0_offset, TAG_EXIF_IFD_POINTER)
            .expect("ExifIFDPointer entry not found in IFD0");
        assert_eq!(ptr_entry.data_type, TYPE_LONG);
        assert_eq!(ptr_entry.count, 1);
    }

    // ========================================================================
    // ExifIFDPointer → Exif SubIFD
    // ========================================================================

    #[test]
    fn exif_ifd_pointer_leads_to_valid_sub_ifd() {
        let bytes = build_exif_bytes(&default_params()).unwrap();
        let ifd0_offset = 8;

        // ExifIFDPointer のオフセット値を取得
        let ptr_entry = find_entry(&bytes, ifd0_offset, TAG_EXIF_IFD_POINTER).unwrap();
        let exif_ifd_offset = ptr_entry.value_offset as usize;

        // Exif SubIFD のエントリ数 = 4（OffsetTime は DateTime なしのため除外）
        let sub_count =
            u16::from_le_bytes([bytes[exif_ifd_offset], bytes[exif_ifd_offset + 1]]);
        assert_eq!(sub_count, 4);

        // 全 4 タグが存在する（OffsetTime は除外）
        assert!(find_entry(&bytes, exif_ifd_offset, TAG_DATE_TIME_ORIGINAL).is_some());
        assert!(find_entry(&bytes, exif_ifd_offset, TAG_DATE_TIME_DIGITIZED).is_some());
        assert!(find_entry(&bytes, exif_ifd_offset, TAG_OFFSET_TIME).is_none());
        assert!(find_entry(&bytes, exif_ifd_offset, TAG_OFFSET_TIME_ORIGINAL).is_some());
        assert!(find_entry(&bytes, exif_ifd_offset, TAG_OFFSET_TIME_DIGITIZED).is_some());
    }

    // ========================================================================
    // データ領域の値検証（IFD オフセット経由で読む）
    // ========================================================================

    #[test]
    fn image_description_readable_via_ifd_offset() {
        let params = default_params();
        let bytes = build_exif_bytes(&params).unwrap();

        let entry = find_entry(&bytes, 8, TAG_IMAGE_DESCRIPTION).unwrap();
        let value = read_ascii(&bytes, entry.value_offset, entry.count);
        assert_eq!(value, "Beautiful World");
    }

    #[test]
    fn datetime_original_readable_via_ifd_offset() {
        let params = ExifWriteParams {
            description: "Test".to_string(),
            date_time_original: "2024:12:31 23:59:59".to_string(),
            timezone_offset: "-05:00".to_string(),
        };
        let bytes = build_exif_bytes(&params).unwrap();

        // ExifIFDPointer → Exif SubIFD
        let ptr = find_entry(&bytes, 8, TAG_EXIF_IFD_POINTER).unwrap();
        let exif_offset = ptr.value_offset as usize;

        let dto = find_entry(&bytes, exif_offset, TAG_DATE_TIME_ORIGINAL).unwrap();
        assert_eq!(read_ascii(&bytes, dto.value_offset, dto.count), "2024:12:31 23:59:59");

        let dtd = find_entry(&bytes, exif_offset, TAG_DATE_TIME_DIGITIZED).unwrap();
        assert_eq!(read_ascii(&bytes, dtd.value_offset, dtd.count), "2024:12:31 23:59:59");

        // OffsetTime は DateTime なしのため書き込まれない
        assert!(find_entry(&bytes, exif_offset, TAG_OFFSET_TIME).is_none());

        let oto = find_entry(&bytes, exif_offset, TAG_OFFSET_TIME_ORIGINAL).unwrap();
        assert_eq!(read_ascii(&bytes, oto.value_offset, oto.count), "-05:00");

        let otd = find_entry(&bytes, exif_offset, TAG_OFFSET_TIME_DIGITIZED).unwrap();
        assert_eq!(read_ascii(&bytes, otd.value_offset, otd.count), "-05:00");
    }

    #[test]
    fn offsets_point_within_blob() {
        let bytes = build_exif_bytes(&default_params()).unwrap();
        let blob_len = bytes.len() as u32;

        // IFD0 の全エントリのオフセットがバイト列内を指す
        let ifd0_offset = 8;
        let count = u16::from_le_bytes([bytes[ifd0_offset], bytes[ifd0_offset + 1]]) as usize;
        for i in 0..count {
            let entry = read_ifd_entry(&bytes, ifd0_offset + 2 + i * 12);
            if entry.data_type == TYPE_ASCII {
                assert!(
                    entry.value_offset + entry.count <= blob_len,
                    "IFD0 entry 0x{:04X} offset {} + count {} exceeds blob length {}",
                    entry.tag,
                    entry.value_offset,
                    entry.count,
                    blob_len
                );
            }
        }

        // Exif SubIFD の全エントリも同様
        let ptr = find_entry(&bytes, ifd0_offset, TAG_EXIF_IFD_POINTER).unwrap();
        let exif_offset = ptr.value_offset as usize;
        let sub_count =
            u16::from_le_bytes([bytes[exif_offset], bytes[exif_offset + 1]]) as usize;
        for i in 0..sub_count {
            let entry = read_ifd_entry(&bytes, exif_offset + 2 + i * 12);
            assert!(
                entry.value_offset + entry.count <= blob_len,
                "Exif SubIFD entry 0x{:04X} offset {} + count {} exceeds blob length {}",
                entry.tag,
                entry.value_offset,
                entry.count,
                blob_len
            );
        }
    }

    // ========================================================================
    // バリデーション
    // ========================================================================

    #[test]
    fn rejects_nul_in_description() {
        let params = ExifWriteParams {
            description: "Bad\0Value".to_string(),
            date_time_original: "2024:01:01 12:00:00".to_string(),
            timezone_offset: "+09:00".to_string(),
        };
        let result = build_exif_bytes(&params);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("NUL"));
    }

    #[test]
    fn rejects_nul_in_datetime() {
        let params = ExifWriteParams {
            description: "Test".to_string(),
            date_time_original: "2024:01:01\012:00:00".to_string(),
            timezone_offset: "+09:00".to_string(),
        };
        let result = build_exif_bytes(&params);
        assert!(result.is_err());
    }

    #[test]
    fn rejects_invalid_datetime_format() {
        let params = ExifWriteParams {
            description: "Test".to_string(),
            date_time_original: "not-a-date".to_string(),
            timezone_offset: "+09:00".to_string(),
        };
        let result = build_exif_bytes(&params);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("date_time_original"));
    }

    #[test]
    fn accepts_hyphen_datetime() {
        // electronUtilController が使う "yyyy-MM-dd HH:mm:ss" フォーマット
        let params = ExifWriteParams {
            description: "Test".to_string(),
            date_time_original: "2024-06-15 18:30:00".to_string(),
            timezone_offset: "+09:00".to_string(),
        };
        assert!(build_exif_bytes(&params).is_ok());
    }

    #[test]
    fn rejects_invalid_timezone_format() {
        let params = ExifWriteParams {
            description: "Test".to_string(),
            date_time_original: "2024:01:01 12:00:00".to_string(),
            timezone_offset: "UTC+9".to_string(),
        };
        let result = build_exif_bytes(&params);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("timezone_offset"));
    }

    #[test]
    fn accepts_negative_timezone() {
        let params = ExifWriteParams {
            description: "Test".to_string(),
            date_time_original: "2024:01:01 12:00:00".to_string(),
            timezone_offset: "-05:00".to_string(),
        };
        assert!(build_exif_bytes(&params).is_ok());
    }

    #[test]
    fn accepts_utc_timezone() {
        let params = ExifWriteParams {
            description: "Test".to_string(),
            date_time_original: "2024:01:01 12:00:00".to_string(),
            timezone_offset: "+00:00".to_string(),
        };
        assert!(build_exif_bytes(&params).is_ok());
    }
}
