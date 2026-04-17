/**
 * Skip fixture: bg/text クラスを含まない要素
 *
 * 期待: severity なし (skip)
 *
 * className 属性はあるが bg-* / text-* クラスを持たないため
 * コントラスト検証の対象外となる。
 * classifyStack は 'skip' を返す。
 */
export function SkipNoColors() {
  return (
    <div className="flex items-center gap-2">
      <span className="font-bold">no color classes here</span>
    </div>
  );
}
