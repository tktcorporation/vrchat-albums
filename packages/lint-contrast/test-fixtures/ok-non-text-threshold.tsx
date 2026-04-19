/**
 * OK fixture: SVG primitives (<circle>) も 非テキスト UI (3:1) 基準で評価。
 *
 * `--mid-fg` は low-bg 上で ratio ≈ 3.66 (light) / 4.11 (dark)。
 * 本文として評価すれば AA 4.5:1 未達で error になる色だが、
 * 非テキスト要素は 3:1 基準なので error なしで通る。
 *
 * 同じ色の <p> は NG fixture (ng-text-threshold.tsx) で AA 未達を検証する。
 * この対照によって「非テキスト要素は閾値が 3:1 に切り替わる」挙動を
 * discriminative に確認できる。
 */
export function OkNonTextThreshold() {
  return (
    <svg className="bg-low-bg">
      <circle className="text-mid-fg" />
    </svg>
  );
}
