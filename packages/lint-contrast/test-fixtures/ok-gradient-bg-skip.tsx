/**
 * OK fixture: グラデーション背景上のテキストは skip。
 *
 * `bg-gradient-to-t from-black/60` のような背景は静的に単色として解けないため、
 * 子要素のコントラスト計算は不正確になる。linter は skip 扱いにして擬陽性を防ぐ。
 */
export function OkGradientBgSkip() {
  return (
    <div className="bg-low-bg">
      <div className="absolute inset-0 bg-gradient-to-t from-black">
        <p className="text-low-fg">text on gradient should be skipped</p>
      </div>
    </div>
  );
}
