export type Viewport<T> = {
  offset: number;
  visible: T[];
  hiddenAbove: number;
  hiddenBelow: number;
  hiddenAboveGroup: string | null;
};

// 端末の行数は有限なので、選択中の項目を含む範囲だけを描画する。
// previousOffset は「前回どこを表示していたか」を表し、選択がその窓の外に
// 出たときだけ動かす（キー操作のたびに選択行を中央へ寄せると一覧全体が動いて読みにくい）。
// ↑/↓ の案内行ぶんとして常に2行を差し引いておく。片方しか出ない場合は1行分
// 余裕ができるだけで、offset ごとに出し分けを再計算するより単純で安全（listHeight を超えない）。
//
// capacity は項目数ではなく行数で数える（1項目がヘッダなら1行、セッションなら2行など
// heightOf が返す値が項目ごとに違うため）。isSessionRow / groupTitleFor を渡すと、
// はみ出し案内の件数をセッション数に絞り、上の案内行に現在のグループ見出しを添えられる。
export function computeViewport<T>(
  items: T[],
  selectedIndex: number,
  listHeight: number,
  previousOffset: number,
  heightOf: (item: T) => number = () => 1,
  isSessionRow: (item: T) => boolean = () => true,
  groupTitleFor: (item: T) => string | null = () => null,
): Viewport<T> {
  if (items.length === 0 || listHeight <= 0) {
    return { offset: 0, visible: [], hiddenAbove: 0, hiddenBelow: 0, hiddenAboveGroup: null };
  }

  const heights = items.map(heightOf);
  const prefix = [0];
  for (const h of heights) prefix.push((prefix[prefix.length - 1] ?? 0) + h);
  const totalRows = prefix[prefix.length - 1] ?? 0;
  const rowsBetween = (start: number, end: number) => (prefix[end] ?? 0) - (prefix[start] ?? 0);

  if (totalRows <= listHeight) {
    return { offset: 0, visible: items, hiddenAbove: 0, hiddenBelow: 0, hiddenAboveGroup: null };
  }

  const capacity = Math.max(1, listHeight - 2);

  // start から数えて capacity 行に収まる最後の項目の次（exclusive）を返す。
  // 1項目も入らない極端な幅でも最低1件は見せる。
  const endForCapacity = (start: number): number => {
    let end = start;
    while (end < items.length && rowsBetween(start, end + 1) <= capacity) end += 1;
    return Math.max(end, Math.min(items.length, start + 1));
  };

  let offset = Math.min(Math.max(previousOffset, 0), items.length - 1);
  if (selectedIndex >= 0) {
    if (selectedIndex < offset) {
      offset = selectedIndex;
    } else {
      // 選択項目の全行が窓に入るまで、offset を後ろへずらす。
      while (offset < selectedIndex && endForCapacity(offset) <= selectedIndex) offset += 1;
    }
  }

  let end = endForCapacity(offset);
  // 末尾まで表示できているのに手前で余白が余る（capacity を使い切っていない）
  // ケースでは、offset を可能な限り手前へ戻して画面を使い切る。
  if (end >= items.length) {
    while (offset > 0 && rowsBetween(offset - 1, items.length) <= capacity) offset -= 1;
    end = items.length;
  }

  const visible = items.slice(offset, end);
  const hiddenAbove = items.slice(0, offset).filter(isSessionRow).length;
  const hiddenBelow = items.slice(end).filter(isSessionRow).length;
  // 見出しだけが隠れてセッションが0件でも、上に何か隠れているなら案内は出す
  // （その場合 hiddenAbove は0のまま、案内行の有無は呼び出し側が offset > 0 相当で判断する）。
  const hiddenAboveGroup = offset > 0 ? groupTitleFor(items[offset] as T) : null;
  return { offset, visible, hiddenAbove, hiddenBelow, hiddenAboveGroup };
}
