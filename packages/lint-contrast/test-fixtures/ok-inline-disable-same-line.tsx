/**
 * OK fixture: 同一行 `lint-contrast-disable` ディレクティブ。
 *
 * `-next-line` サフィックスを持たない `lint-contrast-disable` マーカーが
 * 対象要素と同じ行にあれば、その要素の検査のみ無効化される。
 *
 * next-line 形式 (`ok-inline-disable.tsx`) との両パターンがユニットテストで
 * 回帰検知されるようにするための fixture。
 *
 * 短い本文にしているのは oxfmt が長い JSX を改行すると
 * ディレクティブと要素が別行になって「同一行」の検証にならなくなるため。
 */
export function OkInlineDisableSameLine() {
  return (
    <div className="bg-low-bg">
      <p className="text-low-fg">{/* lint-contrast-disable */}ok</p>
    </div>
  );
}
