import type { JsxStack, Resolution } from './types';

/**
 * TODO: Strategy B (Warn-on-unknown) の判定境界をここで定義する。
 *
 * 与えられた JsxStack の bgStack / textCandidates を見て、
 * この要素を lint 評価対象にするか (resolvable / unknown / skip) を返す。
 *
 * 設計判断の例:
 * - cn(cond && 'bg-red', 'bg-blue') は両方評価するか unknown 扱いか
 * - variant="primary" の cva 解決失敗は unknown か skip か
 * - style={{ background: x }} は必ず skip か unknown か
 *
 * 詳細: issues/20260417-design-system-contrast-lint.md の
 * 「Strategy B 契約」セクションを参照。
 */
export function classifyStack(_stack: JsxStack): Resolution {
  throw new Error(
    'classifyStack is not implemented yet. See issues/20260417-design-system-contrast-lint.md',
  );
}
