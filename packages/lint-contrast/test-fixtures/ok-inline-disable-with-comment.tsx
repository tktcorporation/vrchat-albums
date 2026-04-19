/**
 * OK fixture: directive と対象行の間に説明コメントを挟むパターン。
 *
 * コメント行と空白行はまたげる仕様なので、disable-next-line の後に
 * 補足説明コメントがあっても directive は有効。
 */
export function OkInlineDisableWithComment() {
  return (
    <div className="bg-low-bg">
      {/* lint-contrast-disable-next-line */}
      {/* 説明: 意図的に低コントラストにしている理由の補足 */}
      <p className="text-low-fg">disabled with explanation comment</p>
    </div>
  );
}
