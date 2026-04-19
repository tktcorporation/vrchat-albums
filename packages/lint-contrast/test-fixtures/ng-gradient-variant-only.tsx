/**
 * NG fixture: `hover:bg-gradient-to-t` のように variant prefix 付きの gradient は
 * 通常状態では適用されないため、linter の skip 対象にしてはいけない。
 *
 * 旧実装は GRADIENT_CLASS_PATTERN を生文字列に適用していたため、
 * `bg-low-bg hover:bg-gradient-to-t` を持つ親要素が silent skip され、
 * その配下の text-low-fg は dark モードの AA 違反を見逃していた (Codex P1)。
 *
 * 新実装は variant prefix を剥がしてから判定するため、hover: 付きの gradient は
 * 無視され、通常状態の bg-low-bg (solid) に対する AA 評価が走る。
 */
export function NgGradientVariantOnly() {
  return (
    <div className="bg-low-bg hover:bg-gradient-to-t">
      <p className="text-low-fg">should be evaluated against solid bg</p>
    </div>
  );
}
