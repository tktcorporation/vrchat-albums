import { describe, expect, test } from 'bun:test';
import {
  ASKED,
  CHECKPOINT_INTERVAL,
  LONG_REVIEW_ROUNDS,
  checkpointState,
  formatEntries,
  isConverged,
  judgeCheckpoint,
  judgeConvergence,
  judgeRound,
  parseEntries,
  roundFromFlags,
} from './review-policy.ts';
import type { Entry, Round } from './review-policy.ts';

const sha = 'a'.repeat(40);
const head = 'b'.repeat(40);
const note = '指摘は文書の整合性 2 種類に分類でき、共通の構造的原因は無いと判断した。';
const roundOf = (count: number, overrides: Partial<Round> = {}): Round => ({
  count,
  sha,
  reviewer: 'codex',
  accepted: false,
  ...overrides,
});
const round = (count: number, accepted = false): Entry => ({
  kind: 'round',
  round: roundOf(count, { accepted }),
});
const rounds = (...counts: number[]): Entry[] => counts.map((count) => round(count));
const checkpoint: Entry = { kind: 'checkpoint', decision: ASKED, sha, note: '診断メモ' };

describe('checkpointState', () => {
  test(`${CHECKPOINT_INTERVAL} ラウンドに満たなければ振り返りは要らない`, () => {
    expect(checkpointState(rounds(5, 8)).status).toBe('clear');
  });

  test('件数が最良値を更新していなければ停滞と判定する', () => {
    expect(checkpointState(rounds(5, 8, 6))).toMatchObject({
      status: 'due',
      reason: { kind: 'stalled' },
    });
    expect(checkpointState(rounds(3, 2, 2))).toMatchObject({ reason: { kind: 'stalled' } });
  });

  test('件数が下がり続けていれば、確認は必須にならない', () => {
    expect(checkpointState(rounds(8, 6, 4))).toMatchObject({ status: 'due', reason: null });
  });

  test('停滞は直近の窓だけで判定する。窓より前の最良値は見ない', () => {
    expect(checkpointState(rounds(1, 9, 7, 5))).toMatchObject({ status: 'due', reason: null });
    expect(checkpointState(rounds(1, 9, 7, 8))).toMatchObject({ reason: { kind: 'stalled' } });
  });

  test('振り返りが複数あっても、窓は最後の振り返り以降だけを数える', () => {
    const entries = [...rounds(9, 8, 7), checkpoint, ...rounds(6, 5, 4), checkpoint, ...rounds(9, 8)];
    expect(checkpointState(entries)).toEqual({ status: 'clear', counts: [9, 8], totalRounds: 8 });
  });

  test('最後のラウンドが 0 件か accepted なら停滞ではない', () => {
    expect(checkpointState(rounds(3, 1, 0))).toMatchObject({ reason: null });
    expect(checkpointState([round(2), round(2), round(2, true)])).toMatchObject({ reason: null });
  });

  test('振り返りの記録以降のラウンドだけを窓として数える', () => {
    const state = checkpointState([...rounds(5, 8, 6), checkpoint, round(4)]);
    expect(state).toEqual({ status: 'clear', counts: [4], totalRounds: 4 });
  });

  test(`ラウンドが ${LONG_REVIEW_ROUNDS} に達したら、件数が下がっていても確認を必須にする`, () => {
    const state = checkpointState([...rounds(9, 7, 5), checkpoint, ...rounds(4, 3, 1)]);
    expect(state).toMatchObject({
      status: 'due',
      reason: { kind: 'long', totalRounds: LONG_REVIEW_ROUNDS },
    });
  });

  test('長期化と停滞が重なったら長期化を優先する', () => {
    const state = checkpointState([...rounds(9, 7, 5), checkpoint, ...rounds(4, 3, 3)]);
    expect(state).toMatchObject({ reason: { kind: 'long' } });
  });

  test(`ラウンドが ${LONG_REVIEW_ROUNDS} に満たない間は、下がっている限り確認を求めない`, () => {
    expect(checkpointState(rounds(9, 7, 5))).toMatchObject({ reason: null });
  });
});

describe('judgeConvergence', () => {
  const codexRounds = (...counts: number[]): Round[] => counts.map((count) => roundOf(count));

  test('ラウンドが 1 回だけなら、0 件でも収束しない', () => {
    expect(judgeConvergence(codexRounds(0), sha)).toEqual({ kind: 'too_few', missing: 1 });
  });

  test('2 ラウンドあり、最後が codex で現在の HEAD に対して 0 件なら収束する', () => {
    expect(judgeConvergence(codexRounds(3, 0), sha)).toEqual({ kind: 'converged' });
  });

  test('最後のラウンドが現在の HEAD と違えば、0 件でも収束しない', () => {
    expect(judgeConvergence(codexRounds(3, 0), head)).toEqual({ kind: 'stale_sha' });
  });

  test('最後のラウンドが codex でなければ収束しない', () => {
    const rounds = [roundOf(3), roundOf(0, { reviewer: 'other' })];
    expect(judgeConvergence(rounds, sha)).toEqual({ kind: 'not_codex' });
  });

  test('指摘が残っていれば収束しない。accepted なら残っていても収束する', () => {
    expect(judgeConvergence(codexRounds(3, 2), sha)).toEqual({ kind: 'findings_left' });
    expect(judgeConvergence([roundOf(3), roundOf(2, { accepted: true })], sha)).toEqual({
      kind: 'converged',
    });
  });

  test('isConverged は収束の結果だけを返す', () => {
    expect(isConverged(codexRounds(3, 0), sha)).toBe(true);
    expect(isConverged(codexRounds(3, 2), sha)).toBe(false);
  });
});

describe('judgeRound', () => {
  test('振り返りが済むまで、収束しないラウンドは記録できない', () => {
    const verdict = judgeRound(rounds(8, 6, 4), roundOf(3));
    expect(verdict).toEqual({
      kind: 'blocked',
      state: { status: 'due', counts: [8, 6, 4], totalRounds: 3, reason: null },
    });
  });

  test('窓が 2 ラウンドのうちは、3 ラウンド目を記録でき、追記後の状態で次の振り返りを予告する', () => {
    expect(judgeRound(rounds(8, 6), roundOf(4))).toMatchObject({
      kind: 'record',
      next: { status: 'due', counts: [8, 6, 4], totalRounds: 3, reason: null },
    });
  });

  test('振り返りが必要でも、収束するラウンドは止めない', () => {
    const verdict = judgeRound(rounds(3, 3, 3), roundOf(0, { sha: head }));
    expect(verdict).toMatchObject({ kind: 'record', convergence: { kind: 'converged' } });
  });

  test('accepted のラウンドも、収束するので止めない', () => {
    const verdict = judgeRound(rounds(2, 2, 2), roundOf(2, { sha: head, accepted: true }));
    expect(verdict).toMatchObject({ kind: 'record', convergence: { kind: 'converged' } });
  });

  test('振り返りを記録した後は、同じラウンドを記録できる', () => {
    const entries = rounds(8, 6, 4);
    const accepted = judgeCheckpoint(entries, 'continue', note, head);
    if (accepted.kind !== 'accept') throw new Error('振り返りが受理されなかった');
    expect(judgeRound(accepted.entries, roundOf(3)).kind).toBe('record');
  });
});

describe('judgeCheckpoint', () => {
  test('振り返りの時期でなければ拒否する', () => {
    expect(judgeCheckpoint(rounds(5, 8), 'continue', note, head)).toMatchObject({
      kind: 'reject',
      rejection: { kind: 'not_due' },
    });
  });

  test('停滞時は診断結果と方針についてユーザーに相談するまで受理しない', () => {
    expect(judgeCheckpoint(rounds(5, 8, 6), 'continue', note, head)).toMatchObject({
      rejection: { kind: 'must_ask', reason: { kind: 'stalled' } },
    });
    expect(judgeCheckpoint(rounds(5, 8, 6), 'replan', note, head)).toMatchObject({
      rejection: { kind: 'must_ask', reason: { kind: 'stalled' } },
    });
    expect(judgeCheckpoint(rounds(5, 8, 6), ASKED, note, head).kind).toBe('accept');
  });

  test('長期化時は停滞もしていても asked 以外を拒否する', () => {
    const entries = [...rounds(9, 7, 5), checkpoint, ...rounds(4, 3, 3)];
    expect(judgeCheckpoint(entries, 'replan', note, head)).toMatchObject({
      rejection: { kind: 'must_ask', reason: { kind: 'long' } },
    });
  });

  test('診断メモは 30 文字から受理し、29 文字は拒否する', () => {
    expect(judgeCheckpoint(rounds(8, 6, 4), 'continue', 'あ'.repeat(29), head)).toMatchObject({
      rejection: { kind: 'note_too_short' },
    });
    expect(judgeCheckpoint(rounds(8, 6, 4), 'continue', 'あ'.repeat(30), head).kind).toBe(
      'accept',
    );
  });

  test('メモの前後の空白は取り除く', () => {
    const verdict = judgeCheckpoint(rounds(8, 6, 4), 'continue', `  ${note}\n`, head);
    expect(verdict).toMatchObject({ kind: 'accept' });
    if (verdict.kind === 'accept') expect(verdict.entries.at(-1)).toMatchObject({ note });
  });

  test('受理した振り返りは、畳んだメモと HEAD の SHA を持つ', () => {
    const verdict = judgeCheckpoint(rounds(8, 6, 4), 'replan', `分類:\n${note}`, head);
    expect(verdict).toMatchObject({ kind: 'accept' });
    if (verdict.kind === 'accept') {
      expect(verdict.entries.at(-1)).toEqual({
        kind: 'checkpoint',
        decision: 'replan',
        sha: head,
        note: `分類: ${note}`,
      });
    }
  });
});

describe('記録形式', () => {
  test('書き出した記録を読み戻すと同じ内容になる', () => {
    const entries: Entry[] = [
      round(5),
      { kind: 'round', round: roundOf(2, { reviewer: 'other', accepted: true }) },
      { kind: 'checkpoint', decision: 'replan', sha, note },
    ];
    expect(parseEntries(formatEntries(entries))).toEqual(entries);
  });

  test('メモの無い振り返り行も読める', () => {
    expect(parseEntries(`checkpoint asked ${sha}\n`)).toEqual([
      { kind: 'checkpoint', decision: 'asked', sha, note: '' },
    ]);
  });

  test('フラグは記録形式とラウンドの組み立てで同じ語彙を使う', () => {
    expect(roundFromFlags(2, sha, ['codex', 'accepted'])).toEqual(
      roundOf(2, { reviewer: 'codex', accepted: true }),
    );
    expect(parseEntries(`2 ${sha} codex accepted\n`)).toEqual([
      { kind: 'round', round: roundOf(2, { accepted: true }) },
    ]);
    expect(parseEntries(`2 ${sha} unknown\n`)).toEqual([]);
  });

  test('64 桁の SHA（SHA-256）の行も読める', () => {
    const long = 'c'.repeat(64);
    expect(parseEntries(`3 ${long} codex\ncheckpoint asked ${long} ${note}\n`)).toEqual([
      { kind: 'round', round: roundOf(3, { sha: long }) },
      { kind: 'checkpoint', decision: 'asked', sha: long, note },
    ]);
  });

  test('未知の決定を持つ行は読み飛ばす', () => {
    expect(parseEntries(`checkpoint skip ${sha} ${note}\n`)).toEqual([]);
  });
});
