---
'vrchat-albums': patch
---

fix(deps): macOS ビルドが plist パース失敗で落ちる問題を解消

`electron-builder --mac` の `createMacApp` → `parsePlistFile` で `DOMParser.parseFromString: the provided mimeType "undefined" is not valid` が発生し macOS ビルドが必ず失敗していた問題を修正。

原因は PR #815 で追加した `@xmldom/xmldom: ">=0.8.13"` override が upper bound を持たず `0.9.10` まで解決されていたこと。`@xmldom/xmldom@0.9.0` で DOMParser が仕様準拠化されて mimeType 引数が必須化された一方、`plist@3.1.0` は `parseFromString(xml)` のままで追従していないため、xmldom 0.9 系を引き込むと plist のパースが必ず失敗する。

修正: `pnpm.overrides` の `@xmldom/xmldom` エントリを削除。これにより `plist@3.1.0` 自身の制約 `^0.8.8` が効き、`@xmldom/xmldom@0.8.13`（GHSA-9pgh-qqpf-7wqj 修正済み）に自然解決される。0.8 系の DOMParser は `parseFromString(xml)`（mimeType なし）呼び出しを許容するためプラットフォーム互換性が回復し、セキュリティ後退も発生しない。
