---
'vrchat-albums': patch
---

feat(lint-contrast): 非テキスト UI コンポーネントとグラデ背景の擬陽性を自動で吸収

`@vrchat-albums/lint-contrast` に以下を追加:

- **WCAG 1.4.11 non-text contrast**: `<svg>` / `<circle>` などの SVG primitives と `lucide-react` からインポートしたアイコンコンポーネントは 3:1 基準で評価
- **グラデーション背景の skip**: `bg-gradient-*` / `bg-linear-*` / `bg-radial-*` / `bg-conic-*` を持つ要素とその配下は単色解釈できないため skip
- **inline disable directive**: `{/* lint-contrast-disable-next-line */}` / `// lint-contrast-disable` で個別抑制も可能（通常はルール側で解決する escape hatch）

これにより MigrationDialog / App / PhotoCard 等の装飾アイコンやグラデ上の白文字がコード側に抑制コメントを書かずに擬陽性扱いされなくなる。ユーザー向けの機能変更はなし (内部 lint ツールのみ)。
