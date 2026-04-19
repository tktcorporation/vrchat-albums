/**
 * NG fixture: `{/* ... *\/}` と同じ行にコードが続くとき、以降の低コントラスト要素を
 * directive が誤って抑制しないことを検証する。
 *
 * 旧実装では行頭が `{/*` で行末が `*\/}` でなければ「未閉鎖コメント」として
 * inBlockComment を true にしてしまい、この行以降の行が全てコメント扱いされ、
 * 遠くの error まで directive が silent に抑制していた (Codex P2 指摘)。
 *
 * 新実装は行内でコメントが閉じた後の `<span />` 部分をコード行として認識し、
 * directive の探索はその時点で停止する。結果として下の `<p text-low-fg>` は
 * dark モードで AA 未達のため error として報告されるべき。
 */
export function NgDisableBlockedByInlineCode() {
  return (
    <div className="bg-low-bg">
      {/* lint-contrast-disable-next-line */} <span className="text-white" />
      <p className="text-low-fg">should still be reported</p>
    </div>
  );
}
