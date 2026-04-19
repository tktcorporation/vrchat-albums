/**
 * OK fixture: inline disable directive で low-contrast 要素を抑制する。
 *
 * ng-low-contrast-dark.tsx と同じクラスでも、
 * `lint-contrast-disable-next-line` があれば issue を出さないことを検証する。
 */
export function OkInlineDisable() {
  return (
    <div className="bg-low-bg">
      {/* lint-contrast-disable-next-line */}
      <p className="text-low-fg">disabled by directive</p>
    </div>
  );
}
