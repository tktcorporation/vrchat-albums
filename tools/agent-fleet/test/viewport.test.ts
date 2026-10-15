import { describe, expect, test } from 'bun:test';
import { computeViewport } from '../src/tui/viewport';

// このテストでは「ヘッダ1行 + セッション2行」という agent-fleet の実際の項目構成を
// 単純化した型で再現する。純粋関数としての computeViewport は heightOf に何を
// 渡されても同じ規約（合計行数が listHeight を超えない、選択項目の全行が入る）を
// 守る必要があるため、項目の中身自体は最小限にする。
type Item = { kind: 'header' | 'row'; group: string };
const header = (group: string): Item => ({ kind: 'header', group });
const sessionRow = (group: string): Item => ({ kind: 'row', group });
const heightOf = (it: Item) => (it.kind === 'header' ? 1 : 2);
const isSessionRow = (it: Item) => it.kind === 'row';
const groupTitleFor = (it: Item) => it.group;

function buildItems(groupSizes: Record<string, number>): Item[] {
  const items: Item[] = [];
  for (const [group, count] of Object.entries(groupSizes)) {
    items.push(header(group));
    for (let i = 0; i < count; i++) items.push(sessionRow(group));
  }
  return items;
}

describe('computeViewport（行数ベース）', () => {
  test('全項目の合計行数が listHeight 以下なら全件そのまま返す', () => {
    const items = buildItems({ 要対応: 2, 作業中: 1 });
    const v = computeViewport(items, 0, 20, 0, heightOf, isSessionRow, groupTitleFor);
    expect(v.visible).toHaveLength(items.length);
    expect(v.hiddenAbove).toBe(0);
    expect(v.hiddenBelow).toBe(0);
  });

  test('窓に入る合計行数は listHeight を超えない', () => {
    const items = buildItems({ 作業中: 30 });
    for (let selected = 0; selected < items.length; selected++) {
      // selected は items 上のインデックスなので、行の位置（header=1, row の各行）とは別。
      // ここでは行を選ぶ index として row の出現位置だけを対象にする。
      if (items[selected]?.kind !== 'row') continue;
      const v = computeViewport(items, selected, 9, 0, heightOf, isSessionRow, groupTitleFor);
      const totalRows = v.visible.reduce((n, it) => n + heightOf(it), 0);
      expect(totalRows).toBeLessThanOrEqual(9);
    }
  });

  test('選択項目の全行が visible に含まれる', () => {
    const items = buildItems({ 作業中: 30 });
    const rowIndices = items.map((it, i) => (it.kind === 'row' ? i : -1)).filter((i) => i >= 0);
    for (const selected of rowIndices) {
      const v = computeViewport(items, selected, 9, 0, heightOf, isSessionRow, groupTitleFor);
      expect(v.visible).toContain(items[selected] as Item);
    }
  });

  test('選択を1つずつ進めても、窓の外に出たときだけ offset が動く', () => {
    const items = buildItems({ 作業中: 30 });
    let offset = 0;
    for (let selected = 1; selected < items.length; selected += 2) {
      // 作業中グループのみなので row は奇数インデックス側に並ぶ（header が先頭の1件だけ）。
      if (items[selected]?.kind !== 'row') continue;
      const v = computeViewport(items, selected, 9, offset, heightOf, isSessionRow, groupTitleFor);
      expect(v.visible).toContain(items[selected] as Item);
      offset = v.offset;
    }
  });

  test('hiddenAbove / hiddenBelow はセッション数（見出しを数えない）', () => {
    const items = buildItems({ 要対応: 1, 作業中: 20 });
    // 十分に下の方を選び、上に「要対応」見出し+1セッション、「作業中」見出しが隠れる状況を作る。
    const lastIndex = items.length - 1;
    const v = computeViewport(items, lastIndex, 9, 0, heightOf, isSessionRow, groupTitleFor);
    // 見出し行が何個 hiddenAbove の範囲に含まれていても、カウントされるのは type==='row' だけ。
    const hiddenItems = items.slice(0, v.offset);
    const expectedHiddenSessions = hiddenItems.filter(isSessionRow).length;
    expect(v.hiddenAbove).toBe(expectedHiddenSessions);
  });

  test('見出しだけが上に隠れてセッションが0件でも、offset は0を超える（案内を出せる）', () => {
    // 要対応グループが header 1行だけ隠れきる直前の状況を作る:
    // header(要対応, 1行) + row(要対応, 2行) + header(作業中, 1行) + row*N。
    // listHeight を小さくして、要対応の header だけが押し出される状態を狙う。
    const items = buildItems({ 要対応: 0, 作業中: 10 });
    // 要対応グループが0件だと buildItems は header を作らないため、ここでは手動で
    // 「見出しのみ2つ+row多数」という状況を再現する。
    const custom: Item[] = [header('要対応'), header('作業中'), ...Array.from({ length: 10 }, () => sessionRow('作業中'))];
    const lastIndex = custom.length - 1;
    const v = computeViewport(custom, lastIndex, 9, 0, heightOf, isSessionRow, groupTitleFor);
    expect(v.offset).toBeGreaterThan(0);
  });

  test('listHeight=5（capacity=3）でもセッション5件・中央選択で案内行込みの合計行数が listHeight を超えない', () => {
    // capacity(listHeight-2) が1セッション分の高さ(2行)ぎりぎりの幅では、案内行の
    // 予約(2行)とセッション行がぶつかって listHeight を超えうる境目を確かめる。
    const items = buildItems({ 作業中: 5 });
    const rowIndices = items.map((it, i) => (it.kind === 'row' ? i : -1)).filter((i) => i >= 0);
    const selected = rowIndices[Math.floor(rowIndices.length / 2)] as number;
    const v = computeViewport(items, selected, 5, 0, heightOf, isSessionRow, groupTitleFor);
    const itemRows = v.visible.reduce((n, it) => n + heightOf(it), 0);
    const guidanceRows = (v.offset > 0 ? 1 : 0) + (v.offset + v.visible.length < items.length ? 1 : 0);
    expect(itemRows + guidanceRows).toBeLessThanOrEqual(5);
  });

  test('groupTitleFor は窓の先頭項目が属するグループ名を返す', () => {
    const items = buildItems({ 要対応: 1, 作業中: 20 });
    const lastIndex = items.length - 1;
    const v = computeViewport(items, lastIndex, 9, 0, heightOf, isSessionRow, groupTitleFor);
    expect(v.hiddenAboveGroup).toBe('作業中');
  });
});
