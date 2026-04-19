---
'vrchat-albums': patch
---

fix(ui): ライトモードの色トークンを WCAG AA に適合するよう調整

`--primary` / `--destructive` / `--info` / `--success` / `--warning` / `--muted-foreground` の light mode L 値を下げ、`text-*` / `bg-*` 両用途でコントラスト比 4.5:1 以上を満たすように変更。primary はブランドオレンジの印象を保ちつつ濃いめの色調に、補助テキスト (muted-foreground) は白背景で十分なコントラストを確保する値に調整。併せて ErrorBoundary / SearchOverlay / SqliteConsole / MigrationDialog の `text-*/opacity` 付き文言と `text-warning` 本文を、セマンティックトークンの本来の役割に合わせて書き直し。
