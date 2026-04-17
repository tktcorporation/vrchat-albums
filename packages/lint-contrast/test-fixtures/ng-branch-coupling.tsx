/**
 * Branch-coupling fixture: cn(cond ? 'bg-black text-white' : 'bg-white text-black')
 *
 * ランタイムで発生しうる組合せ:
 *   分岐1 (consequent): bg-black + text-white → ratio ≈ 21 (AA クリア)
 *   分岐2 (alternate):  bg-white + text-black → ratio ≈ 21 (AA クリア)
 *
 * 修正前 (branchId なし): bg × text の直積を評価
 *   bg-black + text-white → OK
 *   bg-black + text-black → ratio ≈ 1 (偽陽性 error!)
 *   bg-white + text-white → ratio ≈ 1 (偽陽性 error!)
 *   bg-white + text-black → OK
 *
 * 修正後 (branchId あり): 同一分岐の組合せのみ評価
 *   bg-black + text-white → OK  (branchId: 'cn:0:c' 同士)
 *   bg-white + text-black → OK  (branchId: 'cn:0:a' 同士)
 *   → 報告なし (偽陽性が除去される)
 */
declare const cond: boolean;
declare function cn(...args: string[]): string;
export function NgBranchCoupling() {
  return (
    <div className={cn(cond ? 'bg-black text-white' : 'bg-white text-black')}>
      Hello
    </div>
  );
}
