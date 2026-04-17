/**
 * OK fixture: dark: バリアントを使用した両モード AA クリアの典型例。
 *
 * 期待: 両モード (light / dark) で severity = 'ok' (ratio >= 4.5)
 *
 * mock-index.css の --background / --foreground を使用:
 *   :root  { --background: 0 0% 100%; --foreground: 0 0% 9%; }   → ratio ≈ 17 (AA クリア)
 *   .dark  { --background: 220 27% 8%; --foreground: 220 15% 85%; } → ratio ≈ 12 (AA クリア)
 *
 * dark: プレフィックス付きバリアントが light モードで正しくスキップされ、
 * dark モードで正しく適用されることを検証するためのフィクスチャ。
 */
export function OkDarkVariant() {
  return (
    <div className="bg-background dark:bg-background">
      <p className="text-foreground dark:text-foreground">
        correct dark variant usage — passes AA in both modes
      </p>
    </div>
  );
}
