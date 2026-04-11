/// VRChat XMP メタデータの読み取り。
///
/// VRChat (2025.3.1以降) は写真に XMP 形式でメタデータを埋め込む。
///
/// 実際の VRChat XMP 構造 (2026-04 確認):
///   - 複数の rdf:Description ノードが異なるネームスペースで存在
///   - vrc:AuthorID, vrc:WorldID, vrc:WorldDisplayName は子要素
///     （仕様書の想定とは異なり、属性ではない）
///   - xmp:Author は xmp ネームスペースの子要素
///     （vrc: ではない）
use roxmltree::Document;

/// VRChat XMP メタデータの読み取り結果
#[derive(Debug, Clone, PartialEq)]
pub struct VrcXmpMetadata {
    pub author_id: Option<String>,
    pub author: Option<String>,
    pub world_id: Option<String>,
    pub world_display_name: Option<String>,
}

/// VRChat の XMP ネームスペース URI
const VRC_NS: &str = "http://ns.vrchat.com/vrc/1.0/";
/// Adobe XMP 標準ネームスペース URI
const XMP_NS: &str = "http://ns.adobe.com/xap/1.0/";

/// XMP XML 文字列から VRChat メタデータを抽出する。
///
/// RDF/XML ツリーを走査し、vrc: / xmp: ネームスペースの要素と属性の両方を探す。
/// AuthorID が存在しなければ VRChat メタデータなしと判断して None を返す。
pub fn parse_vrc_xmp(xmp_xml: &str) -> Option<VrcXmpMetadata> {
    let doc = Document::parse(xmp_xml).ok()?;

    let mut author_id: Option<String> = None;
    let mut author: Option<String> = None;
    let mut world_id: Option<String> = None;
    let mut world_display_name: Option<String> = None;

    // 全ノードを走査して、vrc: / xmp: のフィールドを収集する。
    // VRChat は複数の rdf:Description に分散して格納するため、
    // 特定の Description ノードだけを見るのではなく全体を走査する。
    for node in doc.descendants() {
        let ns = node.tag_name().namespace().unwrap_or("");
        let name = node.tag_name().name();

        match (ns, name) {
            // --- vrc: ネームスペースの子要素 ---
            (VRC_NS, "AuthorID") => {
                if let Some(text) = get_non_empty_text(&node) {
                    author_id = Some(text);
                }
            }
            (VRC_NS, "WorldID") => {
                if let Some(text) = get_non_empty_text(&node) {
                    world_id = Some(text);
                }
            }
            (VRC_NS, "WorldDisplayName") => {
                if let Some(text) = get_non_empty_text(&node) {
                    world_display_name = Some(text);
                }
            }
            (VRC_NS, "Author") => {
                if author.is_none() {
                    if let Some(text) = get_non_empty_text(&node) {
                        author = Some(text);
                    }
                }
            }
            // --- xmp: ネームスペースの子要素（VRChat は Author をここに書く） ---
            (XMP_NS, "Author") => {
                if author.is_none() {
                    if let Some(text) = get_non_empty_text(&node) {
                        author = Some(text);
                    }
                }
            }
            // --- rdf:Description の属性もチェック（テスト用 XMP との互換性） ---
            (_, "Description") => {
                // 属性として格納されている場合（テストで書き込む XMP パケット）
                if author_id.is_none() {
                    if let Some(val) = node.attribute((VRC_NS, "AuthorID")) {
                        if !val.is_empty() {
                            author_id = Some(val.to_string());
                        }
                    }
                }
                if author.is_none() {
                    // vrc:Author 属性
                    if let Some(val) = node.attribute((VRC_NS, "Author")) {
                        if !val.is_empty() {
                            author = Some(val.to_string());
                        }
                    }
                    // xmp:Author 属性（フォールバック）
                    if author.is_none() {
                        if let Some(val) = node.attribute((XMP_NS, "Author")) {
                            if !val.is_empty() {
                                author = Some(val.to_string());
                            }
                        }
                    }
                }
                if world_id.is_none() {
                    if let Some(val) = node.attribute((VRC_NS, "WorldID")) {
                        if !val.is_empty() {
                            world_id = Some(val.to_string());
                        }
                    }
                }
                if world_display_name.is_none() {
                    if let Some(val) = node.attribute((VRC_NS, "WorldDisplayName")) {
                        if !val.is_empty() {
                            world_display_name = Some(val.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // AuthorID がなければ VRChat メタデータなし
    let author_id = author_id?;

    // author のフォールバック: author_id を使う
    let author = author.or_else(|| Some(author_id.clone()));

    Some(VrcXmpMetadata {
        author_id: Some(author_id),
        author,
        world_id,
        world_display_name,
    })
}

/// ノードの直接テキスト内容を取得する（空文字列は None）
fn get_non_empty_text(node: &roxmltree::Node) -> Option<String> {
    let text: String = node
        .children()
        .filter(|c| c.is_text())
        .map(|c| c.text().unwrap_or(""))
        .collect();
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_real_vrchat_xmp_with_child_elements() {
        // 実際の VRChat 写真から取得した XMP 構造（2026-04 確認）
        let xmp = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
    <rdf:Description>
      <xmp:CreatorTool>VRChat</xmp:CreatorTool>
      <xmp:Author>tkt_</xmp:Author>
    </rdf:Description>
    <rdf:Description xmlns:vrc="http://ns.vrchat.com/vrc/1.0/">
      <vrc:WorldID>wrld_b7280487-a1bc-41e2-80f2-942a72e7d2c7</vrc:WorldID>
      <vrc:WorldDisplayName>Hanami Days 花見の日</vrc:WorldDisplayName>
      <vrc:AuthorID>usr_3ba2a992-724c-4463-bc75-7e9f6674e8e0</vrc:AuthorID>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>"#;

        let result = parse_vrc_xmp(xmp);
        assert!(result.is_some());
        let meta = result.unwrap();
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
            Some("Hanami Days 花見の日")
        );
    }

    #[test]
    fn parses_xmp_with_attributes() {
        // テスト用 XMP パケット（属性形式）との互換性
        let xmp = r#"<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:vrc="http://ns.vrchat.com/vrc/1.0/"
      vrc:AuthorID="usr_12345678-1234-1234-1234-123456789012"
      vrc:Author="TestPhotographer"
      vrc:WorldID="wrld_12345678-1234-1234-1234-123456789012"
      vrc:WorldDisplayName="Beautiful World">
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"#;

        let result = parse_vrc_xmp(xmp);
        assert!(result.is_some());
        let meta = result.unwrap();
        assert_eq!(
            meta.author_id.as_deref(),
            Some("usr_12345678-1234-1234-1234-123456789012")
        );
        assert_eq!(meta.author.as_deref(), Some("TestPhotographer"));
    }

    #[test]
    fn parses_private_world_xmp() {
        let xmp = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
    <rdf:Description>
      <xmp:Author>PrivateUser</xmp:Author>
    </rdf:Description>
    <rdf:Description xmlns:vrc="http://ns.vrchat.com/vrc/1.0/">
      <vrc:AuthorID>usr_test</vrc:AuthorID>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>"#;

        let result = parse_vrc_xmp(xmp);
        assert!(result.is_some());
        let meta = result.unwrap();
        assert_eq!(meta.author_id.as_deref(), Some("usr_test"));
        assert_eq!(meta.author.as_deref(), Some("PrivateUser"));
        assert_eq!(meta.world_id, None);
        assert_eq!(meta.world_display_name, None);
    }

    #[test]
    fn returns_none_without_author_id() {
        let xmp = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>SomeApp</xmp:CreatorTool>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>"#;

        assert!(parse_vrc_xmp(xmp).is_none());
    }

    #[test]
    fn handles_japanese_text() {
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

        let result = parse_vrc_xmp(xmp);
        assert!(result.is_some());
        let meta = result.unwrap();
        assert_eq!(meta.author.as_deref(), Some("日本語ユーザー"));
        assert_eq!(
            meta.world_display_name.as_deref(),
            Some("お花見ワールド 🌸")
        );
    }
}
