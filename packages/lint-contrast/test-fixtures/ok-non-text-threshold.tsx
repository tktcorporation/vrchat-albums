/**
 * OK fixture: 非テキスト要素 (<circle>) に 3:1 基準を適用することで、
 * 本文なら AA 未達の組み合わせでも 非テキスト 3:1 はクリアする例を検証する。
 *
 * mock-index.css の `--card: 220 27% 12% / 0.7` (dark) 上の `text-low-fg` は
 * 通常 3.x:1 程度。<p> では error になるが <circle> なら許容される。
 */
export function OkNonTextThreshold() {
  return (
    <svg>
      <circle className="text-foreground" />
    </svg>
  );
}
