/**
 * OK fixture: directive の後に複数行 JSX コメントが続くパターン。
 *
 * 中継行が本文のみ（英字で始まる）のとき、行単位でブロックコメント状態を
 * 追跡しないと誤って「コード行」と判定されて directive が効かなくなる。
 * そのケースが正しく処理されることを検証する。
 */
export function OkInlineDisableMultilineComment() {
  return (
    <div className="bg-low-bg">
      {/* lint-contrast-disable-next-line */}
      {/* 複数行にわたる補足説明コメント。
          このような中継行はコメントの外形トークンを含まず
          本文が英字から始まるため、行単位の状態追跡が必要。 */}
      <p className="text-low-fg">disabled with multiline explanation</p>
    </div>
  );
}
