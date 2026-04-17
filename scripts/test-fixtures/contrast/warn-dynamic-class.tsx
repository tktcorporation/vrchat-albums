/**
 * Warning fixture: 動的クラスで解決不能
 *
 * 期待: severity = 'warning' (unknown resolution → Strategy B)
 *
 * cn(dynamicVar) は実行時に決定されるため、静的解析では解決不能。
 * classifyStack は 'unknown' を返し、warning が発行される。
 *
 * ただし classifyStack が未実装の場合、このフィクスチャのテストは
 * collectJsxStacks の動的クラス検出のみを検証する。
 */

declare const dynamicVar: string;

export function WarnDynamicClass() {
  return (
    <div className="bg-background">
      <p className={`text-foreground ${dynamicVar}`}>dynamic class warning</p>
    </div>
  );
}
