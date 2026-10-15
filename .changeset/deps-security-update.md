---
'vrchat-albums': patch
---

依存パッケージを semver 互換の範囲で更新し、既知の脆弱性を解消した。アプリに同梱される依存では、自動更新が読む YAML のパーサー（js-yaml）と、設定ファイル検証が使う URI パーサー（fast-uri）の脆弱性を解消した。開発・ビルド用の依存では、shell-quote・brace-expansion・@xmldom/xmldom・browserslist などの脆弱性を解消した。
