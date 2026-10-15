import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJsonl } from '../src/collect/fs';
import {
  extractHead,
  extractTail,
  findTranscriptPath,
  projectDirName,
  readTranscriptSummary,
  type TranscriptCache,
} from '../src/collect/transcript';

const fixtures = join(import.meta.dir, 'fixtures', 'transcripts');
const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const cwd = '/workspaces/ws/.claude/worktrees/feature-b';

describe('projectDirName', () => {
  test('パス区切りとドットを - に置き換える', () => {
    expect(projectDirName(cwd)).toBe('-workspaces-ws--claude-worktrees-feature-b');
  });
});

describe('findTranscriptPath', () => {
  test('cwd から導いたディレクトリにあるファイルを返す', () => {
    expect(findTranscriptPath(fixtures, cwd, sessionId)).toBe(
      join(fixtures, '-workspaces-ws--claude-worktrees-feature-b', `${sessionId}.jsonl`),
    );
  });
  test('cwd 由来のディレクトリに無ければ全ディレクトリから探す', () => {
    expect(findTranscriptPath(fixtures, '/elsewhere', sessionId)).toContain(sessionId);
  });
  test('どこにも無ければ null', () => {
    expect(findTranscriptPath(fixtures, cwd, 'zzzz')).toBeNull();
  });
  test('projectsDir がファイルなら null（readdirSync が投げても分類して返す）', () => {
    const fileAsDir = join(fixtures, '-workspaces-ws--claude-worktrees-feature-b', `${sessionId}.jsonl`);
    expect(findTranscriptPath(fileAsDir, '/elsewhere', sessionId)).toBeNull();
  });
});

const records = parseJsonl(
  await Bun.file(join(fixtures, '-workspaces-ws--claude-worktrees-feature-b', `${sessionId}.jsonl`)).text(),
);

describe('extractHead / extractTail', () => {
  test('元の指示は最初の human 発話（meta は飛ばす）', () => {
    expect(extractHead(records).originalPrompt).toBe('ダミーの元の指示: feature-b を実装して');
  });
  test('末尾から最新の指示・最後の assistant 発話・時刻を取る', () => {
    const t = extractTail(records);
    expect(t.latestPrompt).toBe('進めて');
    expect(t.lastAssistantText).toBe('テストを書いています。');
    expect(t.pendingQuestion).toBeNull();
    expect(t.lastTimestamp).toBe(Date.parse('2026-09-05T04:31:00.000Z'));
    expect(t.model).toBe('claude-fable-5-1');
  });
  test('assistant の text は先頭行だけを取り、sidechain は無視する', () => {
    const head = records.slice(0, 3);
    expect(extractTail(head).lastAssistantText).toBe('まず既存コードを読みます。');
  });
  test('末尾が sidechain の assistant でも、直前のメインスレッドの発話を使う', () => {
    const seq = [
      {
        type: 'assistant',
        timestamp: '2026-09-05T00:00:00.000Z',
        isSidechain: false,
        message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: 'main text' }] },
      },
      {
        type: 'assistant',
        timestamp: '2026-09-05T00:00:01.000Z',
        isSidechain: true,
        message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: 'side text' }] },
      },
    ];
    expect(extractTail(seq).lastAssistantText).toBe('main text');
  });
  test('last-prompt マーカーより後に human 発話が続けば、そちらを latestPrompt に採用する', () => {
    const seq = [
      {
        type: 'user',
        origin: { kind: 'human' },
        timestamp: '2026-09-05T00:00:00.000Z',
        isSidechain: false,
        message: { role: 'user', content: 'A' },
      },
      { type: 'last-prompt', lastPrompt: 'A' },
      {
        type: 'user',
        origin: { kind: 'human' },
        timestamp: '2026-09-05T00:00:01.000Z',
        isSidechain: false,
        message: { role: 'user', content: 'B' },
      },
    ];
    expect(extractTail(seq).latestPrompt).toBe('B');
  });
});

describe('malformed AskUserQuestion input', () => {
  test('questions が配列でなくても extractTail は投げず、pendingQuestion は空文字になる', async () => {
    const records = parseJsonl(await Bun.file(join(fixtures, 'malformed-question.jsonl')).text());
    expect(() => extractTail(records)).not.toThrow();
    // qs を空配列扱いにした結果、質問文の join は '' になる。この関数の仕様として
    // 「非配列の questions は null ではなく空文字の pendingQuestion」を返す。
    expect(extractTail(records).pendingQuestion).toBe('');
  });
  test('readTranscriptSummary はこのファイルに対して例外を投げず ok:true を返す', () => {
    const path = join(fixtures, 'malformed-question.jsonl');
    const r = readTranscriptSummary(path, new Map());
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('should succeed');
    expect(r.value.pendingQuestion).toBe('');
  });
});

describe('pendingQuestion', () => {
  test('未回答の AskUserQuestion があれば質問文を返す', async () => {
    const records = parseJsonl(await Bun.file(join(fixtures, 'pending-question.jsonl')).text());
    expect(extractTail(records).pendingQuestion).toBe('対象期間はどれですか？');
  });
  test('tool_result で回答済みなら null', async () => {
    const records = parseJsonl(await Bun.file(join(fixtures, 'answered-question.jsonl')).text());
    expect(extractTail(records).pendingQuestion).toBeNull();
  });
});

describe('readTranscriptSummary', () => {
  test('サイズが同じなら cache を返す', () => {
    const cache: TranscriptCache = new Map();
    const path = join(fixtures, '-workspaces-ws--claude-worktrees-feature-b', `${sessionId}.jsonl`);
    const first = readTranscriptSummary(path, cache);
    expect(first.ok).toBe(true);
    const cached = cache.get(path)!;
    cached.summary.originalPrompt = 'CACHED';
    const second = readTranscriptSummary(path, cache);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('should succeed');
    expect(second.value.originalPrompt).toBe('CACHED');
  });
  test('無いファイルは not_found', () => {
    const r = readTranscriptSummary('/nope.jsonl', new Map());
    if (!r.ok) expect(r.error.type).toBe('not_found');
    else throw new Error('should fail');
  });
  test('ディレクトリを渡すと io_error に分類される（EISDIR は not_found ではない）', () => {
    const r = readTranscriptSummary(fixtures, new Map());
    if (!r.ok) expect(r.error.type).toBe('io_error');
    else throw new Error('should fail');
  });
  test('dangling symlink は例外を投げず分類された失敗になる', () => {
    // symlink の解決先が存在しない状態は、fileSize 呼び出し中にファイルが消える
    // TOCTOU と同様の「存在確認と実読み取りの間で失われる」ケースを再現する。
    const dir = mkdtempSync(join(tmpdir(), 'agent-fleet-symlink-'));
    const link = join(dir, 'dangling.jsonl');
    try {
      symlinkSync('/nonexistent-target-xyz', link);
      const r = readTranscriptSummary(link, new Map());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.type).toBe('not_found');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('256KB を超える transcript は head/tail を別々に読んでも先頭と末尾を両方取れる', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-fleet-transcript-'));
    const path = join(dir, 'big.jsonl');
    try {
      const lines: string[] = [
        JSON.stringify({
          type: 'user',
          origin: { kind: 'human' },
          timestamp: '2026-09-05T00:00:00.000Z',
          isSidechain: false,
          message: { role: 'user', content: 'HEAD-PROMPT' },
        }),
      ];
      // HEAD_BYTES/TAIL_BYTES（256KB）を大きく超えさせ、head 読み取りと tail 読み取りが
      // 重ならないようにするための埋め草レコード。
      const filler = 'x'.repeat(200);
      for (let i = 0; i < 3000; i++) {
        lines.push(
          JSON.stringify({
            type: 'assistant',
            timestamp: '2026-09-05T00:00:01.000Z',
            isSidechain: false,
            message: { role: 'assistant', model: 'filler-model', content: [{ type: 'text', text: filler }] },
          }),
        );
      }
      lines.push(
        JSON.stringify({
          type: 'user',
          origin: { kind: 'human' },
          timestamp: '2026-09-05T01:00:00.000Z',
          isSidechain: false,
          message: { role: 'user', content: 'TAIL-PROMPT' },
        }),
      );
      lines.push(
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-09-05T01:00:01.000Z',
          isSidechain: false,
          message: { role: 'assistant', model: 'filler-model', content: [{ type: 'text', text: 'TAIL-TEXT' }] },
        }),
      );
      writeFileSync(path, `${lines.join('\n')}\n`);
      const result = readTranscriptSummary(path, new Map());
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('should succeed');
      expect(result.value.originalPrompt).toBe('HEAD-PROMPT');
      expect(result.value.latestPrompt).toBe('TAIL-PROMPT');
      expect(result.value.lastAssistantText).toBe('TAIL-TEXT');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
