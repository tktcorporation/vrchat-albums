---
'vrchat-albums': patch
---

fix(ui): ライトモードの色トークンを WCAG AA に適合するよう調整

`--destructive` / `--info` / `--success` / `--warning` / `--muted-foreground` の light mode L 値を下げ、`text-*` / `bg-*` 両用途でコントラスト比 4.5:1 以上を満たすように変更。`--primary` はビビッドオレンジ (52% L) を維持し、`--primary-foreground` を黒 (0% L) に変更することで `bg-primary + text-primary-foreground` ペアの AA を担保。アイコン用途の `text-primary` (App.tsx の progress circle、MigrationDialog のアクセントアイコン) は `text-accent-foreground` (やや濃いめのオレンジ) に置換し非テキスト 3:1 基準をクリア。併せて ErrorBoundary / SearchOverlay / SqliteConsole / MigrationDialog の `text-*/opacity` 付き文言と `text-warning` 本文を、セマンティックトークンの本来の役割に合わせて書き直し。
