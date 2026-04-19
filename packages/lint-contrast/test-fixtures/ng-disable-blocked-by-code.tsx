/**
 * NG fixture: 対象行との間にコード行を挟むと directive は効かない。
 *
 * disable-next-line から対象行までの間にコメント/空白以外のコード行が
 * あれば、関係のない箇所の directive と誤認しないよう無効化される。
 */
export function NgDisableBlockedByCode() {
  return (
    <div className="bg-low-bg">
      {/* lint-contrast-disable-next-line */}
      <span className="text-white">unrelated element</span>
      <p className="text-low-fg">should still be reported</p>
    </div>
  );
}
