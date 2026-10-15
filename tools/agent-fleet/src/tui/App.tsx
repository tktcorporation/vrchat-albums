import { Box, Text, useApp, useInput, useStdout } from 'ink';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SourceError } from '../collect/types';
import { loadAcks, saveAcks, withAck, type AckStore } from '../model/ack';
import { groupRows, type Groups } from '../model/group';
import type { FleetRow, Snapshot } from '../model/row';
import { Detail, DETAIL_MAX_LINES } from './Detail';
import { Header } from './Header';
import { MARGIN } from './row-lines';
import { GroupHeader, RowLine } from './RowList';
import { StatusBar } from './StatusBar';
import { computeViewport } from './viewport';

export type AppProps = {
  collector: { collect(): Promise<Snapshot> };
  ackPath: string;
  intervalMs: number;
  now?: () => number;
  onOpen?: (row: FleetRow) => Promise<string | null>;
  initialSnapshot?: Snapshot;
};

const matchesFilter = (r: FleetRow, q: string) =>
  q === '' || [r.name, r.originalPrompt ?? '', r.location.display].some((s) => s.toLowerCase().includes(q.toLowerCase()));

// loadAcks は分類済みの SourceResult を返す。ack ファイルが読めなくても
// 一覧表示そのものは続けたいので、未確認扱い（空の AckStore）で起動しつつ
// 理由は StatusBar に出す。
function initialAckState(ackPath: string): { acks: AckStore; ackError: SourceError | null } {
  const r = loadAcks(ackPath);
  return r.ok ? { acks: r.value, ackError: null } : { acks: {}, ackError: r.error };
}

// 高さの予算（ヘッダ1 + 一覧 + 区切り1 + 詳細ペイン + ステータス行1）。
// detailHeight は端末高さだけから決め、選択で伸縮させない
// （伸縮させると選択を動かすたびに一覧の行数が跳ねる）。
const MIN_LIST_HEIGHT = 9; // 見出し1 + セッション2行×3 + 案内2（detailHeight を割り当てる際に一覧側へ残す目安）
const LIST_FLOOR = 5; // 案内2行 + セッション1件2行 + 余裕1（一覧が識別できる最小の高さ）
const DETAIL_MIN_LINES = 6; // 保護フィールド（状態1 + 元の指示3 + 要判断2）の合計
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

export function computeHeights(terminalRows: number): { listHeight: number; detailHeight: number } {
  // ヘッダ・区切り・ステータス行の固定3行を引いた残りを、一覧と詳細ペインで分け合う。
  const budget = Math.max(0, terminalRows - 1 - 1 - 1);
  const preferredDetail = clamp(budget - MIN_LIST_HEIGHT, DETAIL_MIN_LINES, DETAIL_MAX_LINES);
  const listHeight = Math.min(budget, Math.max(LIST_FLOOR, budget - preferredDetail));
  // 極端に狭い端末では LIST_FLOOR と DETAIL_MIN_LINES を同時に満たせないことがある。
  // その場合は detailHeight 側を budget に収まるまで縮め、画面の高さそのものを
  // 超えないことを優先する（案内行が Box をはみ出す事態を避ける）。
  const detailHeight = Math.max(0, Math.min(preferredDetail, budget - listHeight));
  return { listHeight, detailHeight };
}

type ListItem =
  | { type: 'header'; key: string; title: string; count: number; hint?: string }
  | { type: 'row'; row: FleetRow; groupTitle: string };

const heightOfItem = (item: ListItem): number => (item.type === 'header' ? 1 : 2);
const isSessionItem = (item: ListItem): boolean => item.type === 'row';
const groupTitleOfItem = (item: ListItem): string | null => (item.type === 'row' ? item.groupTitle : item.title);

function buildItems(groups: Groups, showOther: boolean): ListItem[] {
  const items: ListItem[] = [];
  const push = (key: string, title: string, rows: FleetRow[], collapsed: boolean, hint?: string) => {
    if (rows.length === 0) return;
    items.push({ type: 'header', key, title, count: rows.length, hint });
    if (!collapsed) for (const r of rows) items.push({ type: 'row', row: r, groupTitle: title });
  };
  push('h-pending', '要対応', groups.pending, false);
  push('h-working', '作業中', groups.working, false);
  push('h-idle', '待機', groups.idle, false);
  push('h-other', 'その他', groups.other, !showOther, showOther ? 'c で畳む' : 'c で展開');
  return items;
}

export function App({ collector, ackPath, intervalMs, now = () => Date.now(), onOpen, initialSnapshot }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(initialSnapshot ?? null);
  const [{ acks, ackError }, setAckState] = useState(() => initialAckState(ackPath));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  // stdout.rows/columns は resize イベントでしか変わらない。useWindowSize を使わず
  // 自前で resize を購読するのは、初期値を state に固定する実装だとテストの
  // 「stdout.rows を書き換えて再描画で反映させる」フィクスチャが動かなくなるため
  // （実描画のたびに stdout から読み直しつつ、resize イベントでも再描画を起こす）。
  const [, setResizeTick] = useState(0);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setResizeTick((t) => t + 1);
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  // collect() は herdr / claude / codex を横断して呼ぶため、timer の間隔より長くかかることがある。
  // 前回の収集が終わる前に次を投げると、遅れて届いた古い結果が新しい結果を上書きしうるので、
  // 直列化する（in-flight 中の自動更新は捨て、手動更新だけ「完了後にもう一度」を予約する）。
  // それでも保険として、収集ごとに連番を振り、適用済みより古い結果は捨てる。
  const collectingRef = useRef(false);
  const pendingManualRef = useRef(false);
  const seqRef = useRef(0);
  const appliedSeqRef = useRef(0);

  const runCollect = useCallback(async () => {
    const seq = ++seqRef.current;
    const s = await collector.collect();
    if (seq < appliedSeqRef.current) return; // 自分より新しいリクエストが既に適用済み
    appliedSeqRef.current = seq;
    setSnapshot(s);
  }, [collector]);

  const refresh = useCallback(
    async (manual = false) => {
      if (collectingRef.current) {
        if (manual) pendingManualRef.current = true;
        return;
      }
      collectingRef.current = true;
      try {
        await runCollect();
        while (pendingManualRef.current) {
          pendingManualRef.current = false;
          await runCollect();
        }
      } finally {
        collectingRef.current = false;
      }
    },
    [runCollect],
  );

  useEffect(() => {
    if (!initialSnapshot) void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs, initialSnapshot]);

  const current = now();
  const groups = useMemo(() => {
    const q = filter ?? '';
    const rows = (snapshot?.rows ?? []).filter((r) => matchesFilter(r, q));
    return groupRows(rows, acks, current);
  }, [snapshot, acks, filter, current, tick]);

  const visible = useMemo(
    () => [...groups.pending, ...groups.working, ...groups.idle, ...(showOther ? groups.other : [])],
    [groups, showOther],
  );
  const selectedIndex = Math.max(0, visible.findIndex((r) => r.key === selectedKey));
  const selected = visible[selectedIndex] ?? null;
  useEffect(() => {
    if (selected && selected.key !== selectedKey) setSelectedKey(selected.key);
  }, [selected, selectedKey]);

  // useInput のコールバックはレンダーごとに登録し直されるが、キー入力が連続で
  // 同期的に届くと React の再レンダーが間に合わず、複数回とも同じ selectedIndex を
  // 見てしまう（例: ↓ を25回連打しても1個しか進まない）。ref に最新値を都度書き込み、
  // ハンドラ自身がそれを進めることで、再レンダーを待たずに連続入力を正しく積み上げる。
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const items = useMemo(() => buildItems(groups, showOther), [groups, showOther]);
  const selectedItemIndex = selected ? items.findIndex((it) => it.type === 'row' && it.row.key === selected.key) : -1;

  const width = stdout?.columns ?? 100;
  const terminalRows = stdout?.rows ?? 40;
  const { listHeight, detailHeight } = computeHeights(terminalRows);

  // 選択がスクロール窓の外に出たときだけ窓を動かす。offset は前回描画時点の値に依存するため
  // 副作用として更新する（レンダー中に直接 ref を書き換えると純粋性が崩れる）。
  useEffect(() => {
    setScrollOffset(
      (prev) => computeViewport(items, selectedItemIndex, listHeight, prev, heightOfItem, isSessionItem, groupTitleOfItem).offset,
    );
  }, [items, selectedItemIndex, listHeight]);

  const viewport = computeViewport(items, selectedItemIndex, listHeight, scrollOffset, heightOfItem, isSessionItem, groupTitleOfItem);
  // 案内行の文言。隠れているのが見出しだけ（セッション 0 件）のときは「0 more」と出さず、
  // 見出し名だけを示す。上の案内行には、いま見えている先頭がどのグループかを添える
  // （見出しがスクロールで消えても、どのグループを読んでいるか分かるようにするため）。
  const groupLabel = (title: string | null) => {
    const header = items.find((it): it is Extract<ListItem, { type: 'header' }> => it.type === 'header' && it.title === title);
    return header ? `${header.title} (${header.count})` : null;
  };
  const aboveGroup = groupLabel(viewport.hiddenAboveGroup);
  const aboveText = [viewport.hiddenAbove > 0 ? `${viewport.hiddenAbove} more` : null, aboveGroup].filter(Boolean).join('  ·  ');
  const end = viewport.offset + viewport.visible.length;
  const belowItem = items[end];
  const belowText =
    viewport.hiddenBelow > 0 ? `${viewport.hiddenBelow} more` : belowItem ? (groupLabel(groupTitleOfItem(belowItem)) ?? '') : '';

  const moveSelection = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), visible.length - 1);
      selectedIndexRef.current = clamped;
      setSelectedKey(visible[clamped]?.key ?? null);
    },
    [visible],
  );

  useInput((input, key) => {
    // 絞り込み入力中でも、非印字キーであるページ送り・先頭/末尾は一覧移動として効かせる。
    // g/G/j/k は絞り込み文字列に吸収させたいので、ここでは矢印キー等の非印字キーだけを
    // 素通りさせる（filter !== null の分岐に入れず、以降の通常ハンドラへ落とす）。
    const isNavigationKey = key.upArrow || key.downArrow || key.return || key.pageUp || key.pageDown || key.home || key.end;
    if (filter !== null && !isNavigationKey) {
      if (key.escape) setFilter(null);
      else if (key.backspace || key.delete) setFilter(filter.slice(0, -1));
      else if (input) setFilter(filter + input);
      return;
    }
    const pageSize = Math.max(1, Math.floor((listHeight - 2) / 2));
    if (key.upArrow || input === 'k') moveSelection(selectedIndexRef.current - 1);
    else if (key.downArrow || input === 'j') moveSelection(selectedIndexRef.current + 1);
    else if (key.pageUp) moveSelection(selectedIndexRef.current - pageSize);
    else if (key.pageDown) moveSelection(selectedIndexRef.current + pageSize);
    else if (key.home || input === 'g') moveSelection(0);
    else if (key.end || input === 'G') moveSelection(visible.length - 1);
    else if (key.return && selected && onOpen) void onOpen(selected).then((m) => setMessage(m));
    else if (input === 'a' && selected?.doneMarker) {
      const next = withAck(acks, selected);
      setAckState({ acks: next, ackError: null });
      const r = saveAcks(ackPath, next);
      if (!r.ok) setMessage(`確認済みを保存できない: ${r.error.detail}`);
    } else if (input === 'c') setShowOther((v) => !v);
    else if (input === '/') setFilter('');
    else if (input === 'r') void refresh(true).then(() => setTick((t) => t + 1));
    else if (input === 'q') exit();
  });

  return (
    <Box flexDirection="column" width={width} height={terminalRows}>
      <Header groups={groups} snapshot={snapshot} now={current} width={width} />
      <Box flexDirection="column" flexGrow={1} overflow="hidden" width={width - MARGIN}>
        {viewport.offset > 0 && (
          <Text dimColor>
            {'  '}↑ {aboveText}
          </Text>
        )}
        {viewport.visible.map((it) =>
          it.type === 'header' ? (
            <GroupHeader key={it.key} title={it.title} count={it.count} hint={it.hint} />
          ) : (
            <RowLine key={it.row.key} row={it.row} selected={it.row.key === selected?.key} now={current} width={width} />
          ),
        )}
        {belowItem && <Text dimColor>{'  '}↓ {belowText}</Text>}
      </Box>
      <Text dimColor wrap="truncate-end">{'─'.repeat(Math.max(1, width - MARGIN))}</Text>
      <Box height={detailHeight} overflow="hidden">
        <Detail row={selected} width={width} maxLines={detailHeight} />
      </Box>
      <StatusBar snapshot={snapshot} message={message} filter={filter} ackError={ackError} width={width} />
    </Box>
  );
}
