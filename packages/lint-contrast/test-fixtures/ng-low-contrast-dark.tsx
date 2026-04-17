/**
 * NG fixture: ダークモードでコントラスト比 < 4.5
 *
 * 期待: severity = 'error', theme = 'dark'
 *
 * mock-index.css の --low-bg / --low-fg を使用:
 *   :root  { --low-bg: 0 0% 100%; --low-fg: 0 0% 45%; }  → ratio ≈ 4.76 (AA クリア)
 *   .dark  { --low-bg: 0 0% 15%;  --low-fg: 0 0% 40%; }  → ratio ≈ 2.16 (AA 未満)
 */
export function NgLowContrastDark() {
  return (
    <div className="bg-low-bg">
      <p className="text-low-fg">low contrast in dark mode</p>
    </div>
  );
}
