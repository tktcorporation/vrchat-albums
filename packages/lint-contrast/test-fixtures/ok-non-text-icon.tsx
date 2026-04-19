import { Bug } from 'lucide-react';

/**
 * OK fixture: lucide-react アイコンは 非テキスト UI (3:1) 基準で評価。
 *
 * `--mid-fg` は low-bg 上で ratio ≈ 3.66 (light) / 4.11 (dark)。
 * 本文として評価すれば AA 4.5:1 未達で error になる色だが、
 * 非テキスト要素は 3:1 基準なので 問題なしと判定される。
 *
 * この fixture が「閾値切替が壊れた際にテストも壊れる」discriminative な
 * 検証になっている。`text-foreground` のような両基準で余裕通過する色は
 * 閾値ロジックの回帰検知として機能しないため意図的に避けている。
 */
export function OkNonTextIcon() {
  return (
    <div className="bg-low-bg">
      <Bug className="text-mid-fg" />
    </div>
  );
}
