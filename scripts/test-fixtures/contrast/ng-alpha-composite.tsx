/**
 * NG fixture: bg-white/30 の合成後、fg との比が不足
 *
 * 期待: severity = 'error' (少なくとも1テーマで AA 未満)
 *
 * bg-white/30 = white (r=1,g=1,b=1) with alpha=0.3
 *
 * Light ベース (white):
 *   composited bg = over(white/0.3, white/1.0) = white → ratio vs 55% L fg ≈ 3.35 (AA 未満)
 *
 * Dark ベース (220 27% 8%):
 *   composited bg = over(white/0.3, dark8%) ≈ rgb(0.34, 0.35, 0.37) → ratio vs same fg ≈ 1.88
 *
 * このフィクスチャのテストは compositeOver を直接呼び出して検証する。
 */
export function NgAlphaComposite() {
  return (
    <div className="bg-background">
      <div className="bg-white/30">
        <p className="text-muted-foreground">alpha composite low contrast</p>
      </div>
    </div>
  );
}
