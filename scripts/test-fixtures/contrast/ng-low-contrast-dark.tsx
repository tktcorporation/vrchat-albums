/**
 * NG fixture: ダークモードでコントラスト比 < 4.5
 *
 * 期待: severity = 'error', theme = 'dark'
 *
 * このフィクスチャのテストは、カスタム CSS vars を注入して検証する。
 * カスタム CSS vars の値:
 *   :root { --ng-bg: 0 0% 100%; --ng-fg: 0 0% 45%; }
 *   .dark  { --ng-bg: 0 0% 15%; --ng-fg: 0 0% 40%; }
 *
 * Light: bg = white, fg = 45% L → ratio ≈ 4.76 (AA クリア)
 * Dark:  bg = 15% L,  fg = 40% L → ratio ≈ 2.16 (AA 未満)
 *
 * 注意: 実際の src/index.css に --ng-bg / --ng-fg は定義されていない。
 * テストは parseCssVars にカスタム CSS を渡して検証する。
 */
export function NgLowContrastDark() {
  return (
    <div className="bg-background">
      <p className="text-muted-foreground">low contrast in dark mode</p>
    </div>
  );
}
