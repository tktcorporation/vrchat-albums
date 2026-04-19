/**
 * NG fixture: 本文テキスト (<p>) は WCAG AA 4.5:1 基準で評価される。
 *
 * `--mid-fg` は low-bg 上で ratio ≈ 3.66 (light) / 4.11 (dark)。
 * 非テキスト要素なら 3:1 基準で OK になる色だが、本文テキストでは両モードで
 * AA 4.5:1 を満たさず error になる。
 *
 * ok-non-text-threshold.tsx / ok-non-text-icon.tsx との対照によって
 * 閾値切替ロジック (WCAG_NON_TEXT_THRESHOLD = 3 vs AA = 4.5) の存在を
 * discriminative に検証する。
 */
export function NgTextThreshold() {
  return (
    <div className="bg-low-bg">
      <p className="text-mid-fg">this should be flagged as text-mode error</p>
    </div>
  );
}
