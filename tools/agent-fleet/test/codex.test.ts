import { describe, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJsonl } from '../src/collect/fs';
import {
  collectCodexThreads,
  createCodexCache,
  extractRolloutHead,
  extractRolloutTail,
  findRolloutPath,
  parseHistory,
  parseSessionIndex,
} from '../src/collect/codex';

const home = join(import.meta.dir, 'fixtures', 'codex');

describe('parseHistory', () => {
  test('thread ごとに最初と最後の発話を持つ', async () => {
    const h = parseHistory(await Bun.file(join(home, 'history.jsonl')).text());
    expect(h.get('thread-parent')).toEqual({ first: 'ダミー: 8月の振り返りを書いて', last: '続けて' });
    expect(h.get('thread-other')?.first).toBe('別スレッドの指示');
  });
});

describe('parseSessionIndex', () => {
  test('同じ id は最後の thread_name で上書きする', async () => {
    const idx = parseSessionIndex(await Bun.file(join(home, 'session_index.jsonl')).text());
    expect(idx.get('thread-parent')).toBe('8月の振り返り');
  });
});

describe('rollout', () => {
  const child = join(home, 'sessions', '2026', '09', '04', 'rollout-2026-09-04T02-41-04-thread-child.jsonl');
  test('findRolloutPath は thread id で日付ディレクトリを横断して探す', () => {
    expect(findRolloutPath(join(home, 'sessions'), 'thread-child')).toBe(child);
    expect(findRolloutPath(join(home, 'sessions'), 'nope')).toBeNull();
  });
  test('findRolloutPath は sessionsDir が通常ファイルなら null を返す', () => {
    expect(findRolloutPath(join(home, 'history.jsonl'), 'thread-child')).toBeNull();
  });
  test('年ディレクトリ名の通常ファイルが混ざっていても、他の年ディレクトリから見つかる', () => {
    // sessions/2099 は「年ディレクトリのような名前」を持つ通常ファイル。
    // readdirSync/statSync の catch をこのエントリ単位に絞れているかを見るため、
    // 実在する年ディレクトリ（sessions/2026）と並べて置く。
    expect(findRolloutPath(join(home, 'sessions'), 'thread-parent')).toBe(
      join(home, 'sessions', '2026', '09', '03', 'rollout-2026-09-03T10-00-00-thread-parent.jsonl'),
    );
  });
  test('head は cwd / branch / forked_from_id を取る', async () => {
    const recs = parseJsonl(await Bun.file(child).text());
    expect(extractRolloutHead(recs)).toEqual({
      cwd: '/home/u/.herdr/worktrees/ws/worktree-x',
      branch: 'worktree/x',
      forkedFromId: 'thread-parent',
    });
  });
  test('tail は最後の応答の先頭行と、task_started が後にあれば inProgress', async () => {
    const recs = parseJsonl(await Bun.file(child).text());
    const t = extractRolloutTail(recs);
    expect(t.lastAgentMessage).toBe('章立てを見直しました。');
    expect(t.inProgress).toBe(true);
    expect(t.lastEventAt).toBe(Date.parse('2026-09-04T02:50:00.000Z'));
    expect(t.model).toBe('gpt-5.6-sol');
  });
});

describe('collectCodexThreads', () => {
  test('fork された thread は親の history から元の指示を引く', async () => {
    const r = await collectCodexThreads(['thread-child', 'thread-parent'], home);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const child = r.value.find((t) => t.threadId === 'thread-child')!;
    expect(child.originalPrompt).toBe('ダミー: 8月の振り返りを書いて');
    expect(child.name).toBe('9月目標の執筆');
    expect(child.branch).toBe('worktree/x');
    expect(child.inProgress).toBe(true);
    expect(child.model).toBe('gpt-5.6-sol');
    const parent = r.value.find((t) => t.threadId === 'thread-parent')!;
    expect(parent.latestPrompt).toBe('続けて');
    expect(parent.inProgress).toBe(false);
    expect(parent.lastAgentMessage).toBe('振り返りを書きました。');
  });
  test('rollout が無い thread も history だけで行になる', async () => {
    const r = await collectCodexThreads(['thread-other'], home);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('should not fail');
    expect(r.value[0]?.originalPrompt).toBe('別スレッドの指示');
  });
  test('~/.codex が無ければ not_found', async () => {
    const r = await collectCodexThreads(['x'], '/nope/.codex');
    if (!r.ok) expect(r.error.type).toBe('not_found');
    else throw new Error('should fail');
  });
  test('history.jsonl がディレクトリでも rollout 由来のフィールドは返る', async () => {
    const historyDirHome = join(import.meta.dir, 'fixtures', 'codex-history-dir');
    const r = await collectCodexThreads(['thread-parent'], historyDirHome);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('should not fail');
    const thread = r.value[0]!;
    expect(thread.originalPrompt).toBeNull();
    expect(thread.latestPrompt).toBeNull();
    expect(thread.cwd).toBe('/workspaces/ws');
    expect(thread.lastAgentMessage).toBe('振り返りを書きました。');
  });
  test('rollout パスがディレクトリでも thread は既定値で返る', async () => {
    const dirRolloutHome = join(import.meta.dir, 'fixtures', 'codex-dir-rollout');
    const r = await collectCodexThreads(['thread-dir'], dirRolloutHome);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('should not fail');
    expect(r.value).toEqual([
      {
        threadId: 'thread-dir',
        name: null,
        originalPrompt: null,
        latestPrompt: null,
        cwd: null,
        branch: null,
        lastAgentMessage: null,
        inProgress: false,
        lastEventAt: null,
        forkedFromId: null,
        model: null,
      },
    ]);
  });
});

describe('CodexCache', () => {
  test('ファイルが変わっていない2回目の呼び出しは rollout summary / history / session_index を読み直さない', async () => {
    const cache = createCodexCache();
    const r1 = await collectCodexThreads(['thread-child', 'thread-parent'], home, cache);
    expect(r1.ok).toBe(true);
    const summariesBefore = new Map(cache.summaries);
    const historyBefore = cache.history;
    const indexBefore = cache.index;
    expect(historyBefore).not.toBeNull();
    expect(summariesBefore.size).toBeGreaterThan(0);

    const r2 = await collectCodexThreads(['thread-child', 'thread-parent'], home, cache);
    expect(r2.ok).toBe(true);
    // サイズ不変ならキャッシュのエントリを丸ごと再利用し、新しいオブジェクトへ
    // 差し替えない（参照の同一性が「再パースしなかった」ことの証拠になる）。
    expect(cache.history).toBe(historyBefore);
    expect(cache.index).toBe(indexBefore);
    for (const [path, entry] of cache.summaries) {
      const before = summariesBefore.get(path);
      if (!before) throw new Error(`missing cached summary for ${path}`);
      expect(entry).toBe(before);
    }
    expect(r2).toEqual(r1);
  });

  test('history.jsonl が育つと再パースされ、新しい内容が反映される', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-cache-'));
    writeFileSync(join(dir, 'history.jsonl'), `${JSON.stringify({ session_id: 't1', text: 'first' })}\n`);
    const cache = createCodexCache();
    await collectCodexThreads(['t1'], dir, cache);
    expect(cache.history?.map.get('t1')).toEqual({ first: 'first', last: 'first' });
    const before = cache.history;

    appendFileSync(join(dir, 'history.jsonl'), `${JSON.stringify({ session_id: 't1', text: 'second' })}\n`);
    const r = await collectCodexThreads(['t1'], dir, cache);
    expect(r.ok).toBe(true);
    expect(cache.history).not.toBe(before);
    expect(cache.history?.map.get('t1')).toEqual({ first: 'first', last: 'second' });
    if (r.ok) expect(r.value[0]?.latestPrompt).toBe('second');
  });

  test('rollout ファイルが移動していると、キャッシュ済みパスが無くなった時だけ再探索する', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-cache-rollout-'));
    const sessionsDir = join(dir, 'sessions', '2026', '09', '04');
    mkdirSync(sessionsDir, { recursive: true });
    const original = join(sessionsDir, 'rollout-2026-09-04T00-00-00-t1.jsonl');
    writeFileSync(original, `${JSON.stringify({ type: 'session_meta', payload: { cwd: '/a' } })}\n`);
    const cache = createCodexCache();
    const r1 = await collectCodexThreads(['t1'], dir, cache);
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.value[0]?.cwd).toBe('/a');
    expect(cache.rolloutPath.get('t1')).toBe(original);

    // パスがまだ存在するので、2回目は resolveRolloutPath がキャッシュを使い続ける。
    const r2 = await collectCodexThreads(['t1'], dir, cache);
    expect(cache.rolloutPath.get('t1')).toBe(original);
    if (r2.ok) expect(r2.value[0]?.cwd).toBe('/a');

    // キャッシュ済みパスが消えたときだけ再探索し、新しい場所を見つける。
    const moved = join(sessionsDir, 'rollout-2026-09-04T00-00-01-t1.jsonl');
    renameSync(original, moved);
    const r3 = await collectCodexThreads(['t1'], dir, cache);
    expect(cache.rolloutPath.get('t1')).toBe(moved);
    if (r3.ok) expect(r3.value[0]?.cwd).toBe('/a');
  });

  test('キャッシュ済み rollout パスの実体が消えていても、collector 全体は ok のままその thread は既定値になる', async () => {
    // rolloutPath / summaries のキャッシュ経路にある fileSize 呼び出しが例外を
    // 素通ししていた場合、1 thread ぶんの消失が collectCodexThreads 全体を reject
    // させてしまう回帰の再発防止（他の thread の収集も止めてはいけない）。
    const dir = mkdtempSync(join(tmpdir(), 'codex-cache-missing-'));
    const sessionsDir = join(dir, 'sessions', '2026', '09', '04');
    mkdirSync(sessionsDir, { recursive: true });
    const rollout = join(sessionsDir, 'rollout-2026-09-04T00-00-00-t1.jsonl');
    writeFileSync(rollout, `${JSON.stringify({ type: 'session_meta', payload: { cwd: '/a' } })}\n`);
    const cache = createCodexCache();
    await collectCodexThreads(['t1'], dir, cache);
    expect(cache.rolloutPath.get('t1')).toBe(rollout);

    unlinkSync(rollout);
    const r = await collectCodexThreads(['t1'], dir, cache);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0]).toMatchObject({
        threadId: 't1',
        cwd: null,
        branch: null,
        lastAgentMessage: null,
        inProgress: false,
        model: null,
      });
    }
  });
});
