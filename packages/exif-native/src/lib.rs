/// exif-native: VRChat 写真の XMP/EXIF メタデータを高速に読み書きする napi-rs モジュール。
///
/// exiftool-vendored（Perl 子プロセス）の置き換え。
/// インプロセスで動作し、バッファ直接操作、タイムアウト不要、Rayon による並列処理を提供する。
#[macro_use]
extern crate napi_derive;

mod container;
mod detect;
mod exif;
mod xmp;

use napi::bindgen_prelude::*;
use std::fs;

use container::{jpeg, png};
use detect::{detect_image_format, ImageFormat};
use exif::writer::{build_exif_bytes, ExifWriteParams};
use xmp::reader::{parse_vrc_xmp, VrcXmpMetadata};

// ============================================================================
// napi-rs 公開型
// ============================================================================

/// VRChat XMP メタデータ（読み取り結果）
#[napi(object)]
pub struct JsVrcXmpMetadata {
    pub author_id: Option<String>,
    pub author: Option<String>,
    pub world_id: Option<String>,
    pub world_display_name: Option<String>,
}

impl From<VrcXmpMetadata> for JsVrcXmpMetadata {
    fn from(m: VrcXmpMetadata) -> Self {
        Self {
            author_id: m.author_id,
            author: m.author,
            world_id: m.world_id,
            world_display_name: m.world_display_name,
        }
    }
}

/// EXIF 書き込み用パラメータ
#[napi(object)]
pub struct JsExifWriteParams {
    /// 画像の説明（ワールド名など）
    pub description: String,
    /// 撮影日時 "yyyy:MM:dd HH:mm:ss" 形式
    pub date_time_original: String,
    /// タイムゾーンオフセット "+09:00" 形式
    pub timezone_offset: String,
}

// ============================================================================
// XMP 読み取り
// ============================================================================

/// ファイルパスから VRChat XMP メタデータを読み取る。
///
/// VRChat メタデータが存在しなければ null を返す。
/// PNG の iTXt チャンク / JPEG の APP1 セグメントから XMP XML を抽出し、
/// roxmltree でパースして vrc: ネームスペースの属性を読む。
#[napi]
pub fn read_vrc_xmp(file_path: String) -> Result<Option<JsVrcXmpMetadata>> {
    let data = fs::read(&file_path)
        .map_err(|e| Error::from_reason(format!("Failed to read file {file_path}: {e}")))?;
    read_vrc_xmp_from_bytes(&data)
}

/// バッファから VRChat XMP メタデータを読み取る。
#[napi]
pub fn read_vrc_xmp_from_buffer(buffer: Buffer) -> Result<Option<JsVrcXmpMetadata>> {
    read_vrc_xmp_from_bytes(buffer.as_ref())
}

/// 複数ファイルから VRChat XMP メタデータをバッチ読み取り。
///
/// Rayon でスレッドプール並列化する。
/// 個別のファイルでエラーが発生しても null を返し、他のファイルの処理を続行する。
#[napi]
pub fn read_vrc_xmp_batch(file_paths: Vec<String>) -> Vec<Option<JsVrcXmpMetadata>> {
    use rayon::prelude::*;

    file_paths
        .par_iter()
        .map(|path| {
            let data = match fs::read(path) {
                Ok(d) => d,
                Err(_) => return None,
            };
            match read_vrc_xmp_from_bytes(&data) {
                Ok(meta) => meta,
                Err(_) => None,
            }
        })
        .collect()
}

// ============================================================================
// EXIF 書き込み
// ============================================================================

/// ファイルに EXIF メタデータを書き込む（アトミック書き込み：一時ファイル + rename）。
///
/// ImageDescription, DateTimeOriginal, DateTimeDigitized, OffsetTime* を埋め込む。
/// クラッシュ時のファイル破損を防ぐため、同ディレクトリの .tmp ファイルに書き込んでから rename する。
#[napi]
pub fn write_exif(file_path: String, params: JsExifWriteParams) -> Result<()> {
    let data = fs::read(&file_path)
        .map_err(|e| Error::from_reason(format!("Failed to read file {file_path}: {e}")))?;

    let result = write_exif_to_bytes(&data, &params)?;

    // アトミック書き込み: 同ディレクトリの .tmp ファイルに書き込み → rename
    let tmp_path = format!("{file_path}.tmp");
    fs::write(&tmp_path, &result).map_err(|e| {
        Error::from_reason(format!("Failed to write temp file {tmp_path}: {e}"))
    })?;
    fs::rename(&tmp_path, &file_path).map_err(|e| {
        // rename に失敗した場合、一時ファイルを削除して元のファイルを保護
        let _ = fs::remove_file(&tmp_path);
        Error::from_reason(format!("Failed to rename temp file to {file_path}: {e}"))
    })?;

    Ok(())
}

/// バッファに EXIF メタデータを書き込んで新しいバッファを返す。
#[napi]
pub fn write_exif_to_buffer(buffer: Buffer, params: JsExifWriteParams) -> Result<Buffer> {
    let result = write_exif_to_bytes(buffer.as_ref(), &params)?;
    Ok(Buffer::from(result))
}

// ============================================================================
// ユーティリティ
// ============================================================================

/// バッファの先頭バイトから画像フォーマットを判定する。
#[napi]
pub fn detect_image_format_js(buffer: Buffer) -> String {
    match detect_image_format(buffer.as_ref()) {
        ImageFormat::Jpeg => "jpeg".to_string(),
        ImageFormat::Png => "png".to_string(),
        ImageFormat::Unknown => "unknown".to_string(),
    }
}

// ============================================================================
// 内部ヘルパー
// ============================================================================

fn read_vrc_xmp_from_bytes(data: &[u8]) -> Result<Option<JsVrcXmpMetadata>> {
    let xmp_xml = match detect_image_format(data) {
        ImageFormat::Png => png::extract_xmp_from_png(data)
            .map_err(|e| Error::from_reason(e))?,
        ImageFormat::Jpeg => jpeg::extract_xmp_from_jpeg(data)
            .map_err(|e| Error::from_reason(e))?,
        ImageFormat::Unknown => return Ok(None),
    };

    match xmp_xml {
        Some(xml) => Ok(parse_vrc_xmp(&xml).map(JsVrcXmpMetadata::from)),
        None => Ok(None),
    }
}

fn write_exif_to_bytes(data: &[u8], params: &JsExifWriteParams) -> Result<Vec<u8>> {
    let exif_bytes = build_exif_bytes(&ExifWriteParams {
        description: params.description.clone(),
        date_time_original: params.date_time_original.clone(),
        timezone_offset: params.timezone_offset.clone(),
    })
    .map_err(|e| Error::from_reason(e))?;

    match detect_image_format(data) {
        ImageFormat::Png => {
            // PNG: eXIf チャンクに EXIF を書き込む
            let with_exif = png::set_exif_in_png(data, &exif_bytes)
                .map_err(|e| Error::from_reason(e))?;

            // 既存 XMP がある場合（VRChat の vrc:* フィールド等）は保護し、XMP 書き込みをスキップ。
            // EXIF の ImageDescription だけで Description は十分。
            // 既存 XMP がなければ、互換性のため dc:description を XMP にも書く。
            let existing_xmp = png::extract_xmp_from_png(data)
                .map_err(|e| Error::from_reason(e))?;
            if existing_xmp.is_some() {
                Ok(with_exif)
            } else {
                let xmp_xml = build_description_xmp(&params.description);
                png::set_xmp_in_png(&with_exif, &xmp_xml)
                    .map_err(|e| Error::from_reason(e))
            }
        }
        ImageFormat::Jpeg => {
            // JPEG: APP1 セグメントに EXIF を書き込む
            let with_exif = jpeg::set_exif_in_jpeg(data, &exif_bytes)
                .map_err(|e| Error::from_reason(e))?;

            // 既存 XMP がある場合は保護（VRChat の vrc:* フィールドを上書きしない）。
            // 既存 XMP がなければ、互換性のため dc:description を XMP にも書く。
            let existing_xmp = jpeg::extract_xmp_from_jpeg(data)
                .map_err(|e| Error::from_reason(e))?;
            if existing_xmp.is_some() {
                Ok(with_exif)
            } else {
                let xmp_xml = build_description_xmp(&params.description);
                jpeg::set_xmp_in_jpeg(&with_exif, &xmp_xml)
                    .map_err(|e| Error::from_reason(e))
            }
        }
        ImageFormat::Unknown => Err(Error::from_reason(
            "Unknown image format: cannot write EXIF",
        )),
    }
}

/// Description を含む最小限の XMP パケットを構築する。
///
/// exiftool は Description を XMP の dc:description にマッピングするため、
/// 互換性のために XMP にも書き込む。
fn build_description_xmp(description: &str) -> String {
    // XML 特殊文字をエスケープ
    let escaped = description
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;");

    format!(
        r#"<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:description>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">{escaped}</rdf:li>
        </rdf:Alt>
      </dc:description>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"#
    )
}
