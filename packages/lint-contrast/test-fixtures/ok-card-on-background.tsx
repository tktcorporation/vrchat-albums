/**
 * OK fixture: bg-background + text-foreground
 *
 * 期待: severity なし (両モードで AA クリア)
 *
 * Light: bg = hsl(0 0% 100%) = white, fg = hsl(0 0% 9%) = near-black
 *   → ratio ≈ 17.94 (AA クリア)
 * Dark: bg = hsl(220 27% 8%) ≈ #0d1014, fg = hsl(220 15% 85%) ≈ #ced4de
 *   → ratio ≈ 12.92 (AA クリア)
 */
export function OkCardOnBackground() {
  return (
    <div className="bg-background">
      <p className="text-foreground">hello</p>
    </div>
  );
}
