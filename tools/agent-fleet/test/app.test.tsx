import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import React from 'react';
import { loadAcks } from '../src/model/ack';
import type { FleetRow, Snapshot } from '../src/model/row';
import { App, computeHeights } from '../src/tui/App';
import { textWidth } from '../src/tui/format';

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

const now = 10_000_000_000;
const row = (over: Partial<FleetRow>): FleetRow => ({
  key: over.key ?? 'k', agent: 'claude', kind: 'interactive', name: 'name', model: null, status: 'working', statusSource: 'herdr',
  statusNote: null, originalPrompt: '元の指示の全文です', latestPrompt: '進めて', activity: '作業中の説明', pending: null,
  location: { cwd: '/w', display: '.claude/worktrees/x', branch: 'feat/x', paneId: 'w1:p1' }, artifacts: [],
  startedAt: now - 60_000, updatedAt: now - 5_000, doneMarker: null, attach: { type: 'focus', paneId: 'w1:p1' }, ...over,
});
const snapshot: Snapshot = {
  rows: [
    row({ key: 'b', name: 'blocked one', status: 'blocked', pending: { kind: 'input needed', text: '期間はどれ？' } }),
    row({ key: 'd', name: 'done one', status: 'done', doneMarker: '1', artifacts: [{ kind: 'pr', id: '100', href: 'https://x/pull/100' }] }),
    row({ key: 'w', name: 'working one' }),
  ],
  sources: { herdr: null, claudeAgents: { type: 'not_running', detail: 'claude missing' }, claudeJobs: null, claudeSessions: null, codex: null, worktrees: null, transcripts: null },
  collectedAt: now,
};
const collector = { collect: async () => snapshot };
const tick = () => new Promise((r) => setTimeout(r, 30));

// テストごとに ink インスタンスと ack 用の一時ディレクトリを残さないよう、
// 生成した unmount / ディレクトリを afterEach でまとめて片付ける。
const tempDirs: string[] = [];
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeAckPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'app-'));
  tempDirs.push(dir);
  return join(dir, 'ack.json');
}

function renderApp(...args: Parameters<typeof render>) {
  const instance = render(...args);
  unmounts.push(instance.unmount);
  return instance;
}

// resolve() は呼び出した瞬間に値を確定させるが、誰も await していなければ
// そのまま待機される。呼び出し「順序」と「実際に読まれる順序」を分けてテストできる。
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('App', () => {
  test('グループと詳細と源の失敗を描く', async () => {
    const ackPath = makeAckPath();
    const { lastFrame } = renderApp(<App collector={collector} ackPath={ackPath} intervalMs={60_000} now={() => now} initialSnapshot={snapshot} />);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('要対応 (2)');
    expect(frame).toContain('作業中 (1)');
    expect(frame).toContain('期間はどれ？');
    expect(frame).toContain('元の指示の全文です');
    expect(frame).toContain('claudeAgents: claude missing');
  });
  test('↓ で選択が移り、a で done を確認済みにして要対応から消える', async () => {
    const ackPath = makeAckPath();
    const { lastFrame, stdin } = renderApp(<App collector={collector} ackPath={ackPath} intervalMs={60_000} now={() => now} initialSnapshot={snapshot} />);
    await tick();
    stdin.write('[B'); // ↓
    await tick();
    expect(lastFrame()).toContain('PR #100');
    stdin.write('a');
    await tick();
    expect(lastFrame()).toContain('要対応 (1)');
    const r = loadAcks(ackPath);
    expect(r.ok ? r.value : null).toEqual({ d: '1' });
  });
  test('/ で絞り込み、Esc で解除', async () => {
    const ackPath = makeAckPath();
    const { lastFrame, stdin } = renderApp(<App collector={collector} ackPath={ackPath} intervalMs={60_000} now={() => now} initialSnapshot={snapshot} />);
    await tick();
    stdin.write('/');
    await tick();
    stdin.write('working');
    await tick();
    expect(lastFrame()).not.toContain('blocked one');
    expect(lastFrame()).toContain('working one');
    stdin.write(''); // Esc
    await tick();
    expect(lastFrame()).toContain('blocked one');
  });
  test('Enter は onOpen を呼び、戻り値をステータス行に出す', async () => {
    const ackPath = makeAckPath();
    // let + null 初期化だと TS の制御フロー解析が非同期コールバック越しの
    // 再代入を追えず、以降ずっと型を null に絞り込んでしまう。参照経由にして回避する。
    const opened: { key: string | null } = { key: null };
    const { lastFrame, stdin } = renderApp(
      <App collector={collector} ackPath={ackPath} intervalMs={60_000} now={() => now} initialSnapshot={snapshot} onOpen={async (r) => { opened.key = r.key; return `opened ${r.name}`; }} />,
    );
    await tick();
    stdin.write('\r');
    await tick();
    expect(opened.key).toBe('b');
    expect(lastFrame()).toContain('opened blocked one');
  });

  test('全角名でも age 列の表示上の開始位置がそろう（padDisplay）', async () => {
    const ackPath = makeAckPath();
    const wide: Snapshot = {
      ...snapshot,
      rows: [
        row({ key: 'j', name: '日本語の名前です', status: 'working', activity: null }),
        row({ key: 'e', name: 'ascii-name', status: 'working', activity: null }),
      ],
    };
    const wideCollector = { collect: async () => wide };
    const { lastFrame } = renderApp(<App collector={wideCollector} ackPath={ackPath} intervalMs={60_000} now={() => now} initialSnapshot={wide} />);
    await tick();
    const lines = (lastFrame() ?? '').split('\n').filter((l) => l.includes('int')).map(stripAnsi);
    expect(lines).toHaveLength(2);
    // 全角文字は1文字が2表示幅を使うため、生の文字インデックス(indexOf)は
    // 全角行の方が短くなり一致しない（padDisplay が表示幅に合わせて padEnd より
    // 少ない文字数で埋めるため）。実際に揃うべきなのは端末上の表示幅なので、
    // indexOf で見つけた位置までの部分文字列を textWidth で測って比較する。
    const displayOffsets = lines.map((l) => textWidth(l.slice(0, l.lastIndexOf('5s'))));
    expect(displayOffsets[0]).toBeGreaterThan(0);
    expect(displayOffsets[0]).toBe(displayOffsets[1]);
  });

  test('全ての行が age トークンで終わり、その表示上の開始位置がそろう', async () => {
    const ackPath = makeAckPath();
    const { lastFrame } = renderApp(<App collector={collector} ackPath={ackPath} intervalMs={60_000} now={() => now} initialSnapshot={snapshot} />);
    await tick();
    const lines = (lastFrame() ?? '').split('\n').filter((l) => l.includes('int') || l.includes('bg ')).map(stripAnsi);
    expect(lines).toHaveLength(3); // blocked one / done one / working one
    // age は formatAge().padStart(4) で必ず数字+単位(s/m/h/d)の形になる。
    // padStart は末尾に余白を足さないため、行は必ずこのトークンで終わるはず。
    for (const l of lines) expect(l).toMatch(/\d+[smhd]$/);
    const ageStarts = lines.map((l) => textWidth(l) - textWidth(l.match(/\d+[smhd]$/)?.[0] ?? ''));
    expect(new Set(ageStarts).size).toBe(1); // 3行とも同じ表示幅で始まる
  });

  test('先に要求した収集の解決が後から要求した収集の解決より後でも、最終的に後者の結果になる', async () => {
    const ackPath = makeAckPath();
    const firstSnapshot: Snapshot = { ...snapshot, rows: [row({ key: 'x', name: 'first snapshot', status: 'working' })] };
    const secondSnapshot: Snapshot = { ...snapshot, rows: [row({ key: 'y', name: 'second snapshot', status: 'working' })] };
    let calls = 0;
    const d1 = deferred<Snapshot>();
    const d2 = deferred<Snapshot>();
    const raceCollector = {
      collect: () => {
        calls += 1;
        return calls === 1 ? d1.promise : d2.promise;
      },
    };
    const { lastFrame, stdin } = renderApp(<App collector={raceCollector} ackPath={ackPath} intervalMs={60_000} now={() => now} />);
    await tick(); // マウント時の自動収集(1回目)が in-flight になる
    stdin.write('r'); // in-flight 中の手動更新(2回目)は pending として積まれ、即座には呼ばれない
    await tick();
    expect(calls).toBe(1);
    // 1回目より後に要求された2回目の Promise を、1回目より先に resolve しておく。
    // 収集は直列化されており2回目はまだ呼ばれていない（calls===1）ため、この時点では
    // まだ何も反映されない。「先に要求した1回目の解決が、後に要求した2回目の解決より
    // 後で起こっても構わない」ことを確かめるのが狙い。
    d2.resolve(secondSnapshot);
    await tick();
    expect(calls).toBe(1);
    d1.resolve(firstSnapshot);
    await tick();
    expect(calls).toBe(2); // 1回目の完了を受けて pending の2回目が呼ばれ、既に解決済みの d2 で即座に完了する
    const frame = lastFrame() ?? '';
    expect(frame).toContain('second snapshot');
    expect(frame).not.toContain('first snapshot');
  });

  test('端末の行数に収まるようウィンドウ表示し、選択行を追従する', async () => {
    const ackPath = makeAckPath();
    const many: Snapshot = {
      ...snapshot,
      rows: Array.from({ length: 30 }, (_, i) =>
        row({ key: `r${i}`, name: `row ${i}`, status: 'working', activity: null, originalPrompt: null, latestPrompt: null }),
      ),
    };
    const manyCollector = { collect: async () => many };
    const { lastFrame, stdin, stdout } = renderApp(<App collector={manyCollector} ackPath={ackPath} intervalMs={60_000} now={() => now} initialSnapshot={many} />);
    // ink-testing-library の Stdout は rows を持たないプレーンなプロパティなので、
    // レンダー後に書き換えれば次の再描画（キー入力）から反映される。
    (stdout as unknown as { rows: number }).rows = 20;
    await tick();
    for (let i = 0; i < 25; i++) stdin.write('[B'); // ↓ を25回
    await tick();
    const frame = lastFrame() ?? '';
    const lineCount = frame.split('\n').filter((l) => l.length > 0).length;
    expect(lineCount).toBeLessThanOrEqual(20);
    expect(frame).toContain('row 25');
  });

  const longText = (label: string) => `${label} `.repeat(80).trim();
  const packedSnapshot = (): Snapshot => ({
    ...snapshot,
    rows: [
      row({
        key: 'full',
        name: 'fully packed row',
        status: 'blocked',
        model: 'claude-fable-5-1[1m]',
        originalPrompt: longText('元の指示'),
        latestPrompt: longText('最新の指示'),
        activity: longText('いま'),
        pending: { kind: 'input needed', text: longText('要判断') },
        artifacts: [
          { kind: 'pr', id: '1', href: 'https://example.test/pull/1' },
          { kind: 'pr', id: '2', href: 'https://example.test/pull/2' },
          { kind: 'pr', id: '3', href: 'https://example.test/pull/3' },
        ],
        attach: { type: 'hint', text: longText('移動') },
      }),
    ],
  });

  test('詳細ペインの全項目が長文でも、rows=40（detailHeight=13）では8ラベル全部が出る', async () => {
    const ackPath = makeAckPath();
    const packed = packedSnapshot();
    const packedCollector = { collect: async () => packed };
    const { lastFrame, stdin, stdout } = renderApp(<App collector={packedCollector} ackPath={ackPath} intervalMs={60_000} now={() => now} initialSnapshot={packed} />);
    (stdout as unknown as { rows: number }).rows = 40;
    // stdout.rows の書き換えはそれ自体では再描画を起こさないため、無害なキー入力で
    // 状態を1つ更新して次のレンダーに反映させる（'c' はこのフィクスチャに
    // その他グループが無いので見た目には影響しない）。
    stdin.write('c');
    await tick();
    const frame = lastFrame() ?? '';
    const lineCount = frame.split('\n').filter((l) => l.length > 0).length;
    expect(lineCount).toBeLessThanOrEqual(40);
    // detailHeight=13 は DETAIL_MAX_LINES と一致し、8フィールド全部の上限を賄いきる。
    for (const label of ['元の指示', '最新の指示', 'いま', 'モデル', '要判断', '場所', '成果物', '移動']) {
      expect(frame).toContain(label);
    }
  });

  test('詳細ペインの全項目が長文でも、rows=20 の端末で全体が収まる', async () => {
    const ackPath = makeAckPath();
    const packed = packedSnapshot();
    const packedCollector = { collect: async () => packed };
    const { lastFrame, stdin, stdout } = renderApp(<App collector={packedCollector} ackPath={ackPath} intervalMs={60_000} now={() => now} initialSnapshot={packed} />);
    (stdout as unknown as { rows: number }).rows = 20;
    stdin.write('c');
    await tick();
    const frame = lastFrame() ?? '';
    const lineCount = frame.split('\n').filter((l) => l.length > 0).length;
    expect(lineCount).toBeLessThanOrEqual(20);
    // detailHeight は端末高さだけで決まり（選択で伸縮しない）、rows=20 では
    // 全フィールド分の行数を賄いきれない。そのときも「何を頼まれ、今どこで
    // 止まっているか」の核（元の指示・要判断）だけは末尾から間引かれずに残る
    // （共有予算だと先頭の項目が長いだけで後続がまるごと消える不具合の再発防止）。
    for (const label of ['元の指示', '要判断']) {
      expect(frame).toContain(label);
    }
    // 落ちるべき末尾フィールド（移動）は、この高さでは間引かれて出ない。
    // ステータス行のキー help にも「Enter 移動」の語が出るため、詳細ペインの
    // ラベル位置（行頭）に限って判定する。
    expect(stripAnsi(frame)).not.toMatch(/^移動\s/m);
  });

  test('30行 + 長い源エラー3件でも、rows=20 columns=80 の端末で全体が収まる（StatusBar は1行に収める）', async () => {
    const ackPath = makeAckPath();
    const longDetail = (label: string) => `${label}詳細 `.repeat(40).trim();
    const many: Snapshot = {
      ...snapshot,
      rows: Array.from({ length: 30 }, (_, i) => row({ key: `r${i}`, name: `row ${i}`, status: 'working', activity: null })),
      sources: {
        herdr: { type: 'not_running', detail: longDetail('herdr') },
        claudeAgents: { type: 'not_running', detail: longDetail('claudeAgents') },
        claudeJobs: null,
        claudeSessions: null,
        codex: null,
        worktrees: null,
        transcripts: { type: 'io_error', detail: longDetail('transcripts') },
      },
    };
    const manyCollector = { collect: async () => many };
    const { lastFrame, stdin, stdout } = renderApp(
      <App collector={manyCollector} ackPath={ackPath} intervalMs={60_000} now={() => now} initialSnapshot={many} />,
    );
    (stdout as unknown as { rows: number }).rows = 20;
    // columns は ink-testing-library の Stdout でゲッター実装（常に100を返す）のため、
    // 単純代入では上書きできない。インスタンス自身に own property を定義して隠す。
    Object.defineProperty(stdout, 'columns', { value: 80, configurable: true });
    stdin.write('c'); // 無害なキー入力で再描画のトリガーにする
    await tick();
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeLessThanOrEqual(20);
    // ANSI エスケープを剥がした表示幅そのもので判定する（色数が増えるとエスケープの
    // バイト数だけで閾値を超えてしまい、折り返しの有無を正しく判定できないため）。
    expect(lines.every((l) => textWidth(stripAnsi(l)) <= 80)).toBe(true);
  });

  test.each([
    [80, 20],
    [80, 40],
    [120, 20],
    [120, 40],
  ])('幅%i×高さ%iのどの組み合わせでも各行が端末幅を超えず、行数が端末高さを超えない', async (width, height) => {
    const ackPath = makeAckPath();
    const many: Snapshot = {
      ...snapshot,
      rows: Array.from({ length: 10 }, (_, i) =>
        row({
          key: `r${i}`,
          name: `row ${i} 日本語混じりの名前`,
          status: i % 3 === 0 ? 'blocked' : 'working',
          pending: i % 3 === 0 ? { kind: 'input needed', text: '確認お願いします' } : null,
        }),
      ),
    };
    const manyCollector = { collect: async () => many };
    const { lastFrame, stdin, stdout } = renderApp(
      <App collector={manyCollector} ackPath={ackPath} intervalMs={60_000} now={() => now} initialSnapshot={many} />,
    );
    (stdout as unknown as { rows: number }).rows = height;
    Object.defineProperty(stdout, 'columns', { value: width, configurable: true });
    stdin.write('c');
    await tick();
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeLessThanOrEqual(height);
    for (const l of lines) expect(textWidth(stripAnsi(l))).toBeLessThanOrEqual(width);
  });

  test('stdout.rows を変えて resize を発火するだけで（キー入力なし）再描画され行数が変わる', async () => {
    const ackPath = makeAckPath();
    const many: Snapshot = {
      ...snapshot,
      rows: Array.from({ length: 30 }, (_, i) => row({ key: `r${i}`, name: `row ${i}`, status: 'working', activity: null })),
    };
    const manyCollector = { collect: async () => many };
    const { lastFrame, stdout } = renderApp(<App collector={manyCollector} ackPath={ackPath} intervalMs={60_000} now={() => now} initialSnapshot={many} />);
    await tick();
    const before = (lastFrame() ?? '').split('\n').filter((l) => l.length > 0).length;
    (stdout as unknown as { rows: number }).rows = 15;
    stdout.emit('resize');
    await tick();
    const after = (lastFrame() ?? '').split('\n').filter((l) => l.length > 0).length;
    expect(after).toBeLessThan(before);
  });

  test('絞り込み中は PgDn/Home/End で選択が動き、g/G/j/k は絞り込み文字列に吸収される', async () => {
    const ackPath = makeAckPath();
    const many: Snapshot = {
      ...snapshot,
      rows: Array.from({ length: 10 }, (_, i) => row({ key: `r${i}`, name: `row ${i}`, status: 'working', activity: null })),
    };
    const manyCollector = { collect: async () => many };
    const { lastFrame, stdin } = renderApp(<App collector={manyCollector} ackPath={ackPath} intervalMs={60_000} now={() => now} initialSnapshot={many} />);
    await tick();
    stdin.write('/');
    await tick();
    expect(lastFrame()).toContain('絞り込み:');
    // フィルタは空文字のまま（全件ヒット）なので、PgDn/End は一覧移動として効く。
    stdin.write('\x1b[6~'); // PgDn
    await tick();
    stdin.write('\x1b[4~'); // End
    await tick();
    expect(lastFrame()).toContain('row 9'); // End で末尾へ
    expect(lastFrame()).toContain('絞り込み: '); // フィルタ文字列自体は空のまま

    // g/G/j/k は絞り込み文字列としてタイプされるだけで、一覧移動には使われない。
    stdin.write('g');
    await tick();
    stdin.write('G');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('k');
    await tick();
    expect(lastFrame()).toContain('絞り込み: gGjk');

    // Home は非印字キーなので、絞り込み文字列を変えずに一覧移動として効く。
    stdin.write('\x1b[1~'); // Home
    await tick();
    expect(lastFrame()).toContain('絞り込み: gGjk');
  });

  test('隠れているのが見出しだけ（セッション0件）のとき、案内行は見出し名を示す（N more ではない）', async () => {
    const ackPath = makeAckPath();
    // rows=20 のとき listHeight=9・capacity=7。作業中3件(1+2*3=7行)がちょうど埋まり、
    // 畳んだ「その他」見出し1行だけが capacity を超えて隠れる配置を作る。
    const packed: Snapshot = {
      ...snapshot,
      rows: [
        ...Array.from({ length: 3 }, (_, i) => row({ key: `w${i}`, name: `working ${i}`, status: 'working', activity: null })),
        row({ key: 'o0', name: 'other 0', status: 'done', doneMarker: 'x', activity: null }),
      ],
    };
    const collector2 = { collect: async () => packed };
    const { lastFrame, stdin, stdout } = renderApp(<App collector={collector2} ackPath={ackPath} intervalMs={60_000} now={() => now} initialSnapshot={packed} />);
    (stdout as unknown as { rows: number }).rows = 20;
    stdin.write('a'); // done を確認済みにし、その他グループへ畳んだまま押し出す
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('その他 (1)');
    expect(frame).not.toContain('more');
  });
});

describe('computeHeights', () => {
  test.each([5, 10, 14, 20, 24, 40, 60])('高さ%iでは 1 + listHeight + 1 + detailHeight + 1 <= rows（rows>=12 では ==）', (rows) => {
    const { listHeight, detailHeight } = computeHeights(rows);
    const total = 1 + listHeight + 1 + detailHeight + 1;
    expect(total).toBeLessThanOrEqual(rows);
    if (rows >= 12) expect(total).toBe(rows);
  });
});
