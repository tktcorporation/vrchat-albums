import { describe, expect, it } from 'vitest';

import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  type ParsedErrorInfo,
} from '../../types/errors';
import {
  decideTerms,
  type EntryEvent,
  type EntryState,
  hasConsented,
  initialEntryState,
  reduceEntryFlow,
} from '../entryFlow';

const errorOf = (category: ParsedErrorInfo['category']): ParsedErrorInfo => ({
  code: ERROR_CODES.UNKNOWN,
  category,
  userMessage: 'failed',
  isSetupRequired: category === ERROR_CATEGORIES.SETUP_REQUIRED,
  isPermissionDenied: category === ERROR_CATEGORIES.PERMISSION_DENIED,
  isUnknown: category === ERROR_CATEGORIES.UNKNOWN_ERROR,
});

const run = (events: EntryEvent[], from: EntryState = initialEntryState) =>
  events.reduce(reduceEntryFlow, from);

describe('decideTerms', () => {
  it('未同意なら新規の同意を求める', () => {
    expect(decideTerms({ accepted: false, version: '' }, '2')).toEqual({
      kind: 'required',
      reason: 'new',
    });
  });

  it('同意済みでも版が異なれば同意し直してもらう', () => {
    expect(decideTerms({ accepted: true, version: '1' }, '2')).toEqual({
      kind: 'required',
      reason: 'update',
    });
  });

  it('現在の版に同意済みなら同意画面を出さない', () => {
    expect(decideTerms({ accepted: true, version: '2' }, '2')).toEqual({
      kind: 'accepted',
    });
  });
});

describe('reduceEntryFlow', () => {
  it('同意済みなら規約の確認からそのまま初期化へ進む', () => {
    expect(
      run([{ type: 'termsChecked', decision: { kind: 'accepted' } }]),
    ).toEqual({ phase: 'initializing', attempt: 1 });
  });

  it('同意が要るときは、同意するまで初期化へ進まない', () => {
    const required = run([
      {
        type: 'termsChecked',
        decision: { kind: 'required', reason: 'update' },
      },
    ]);
    expect(required).toEqual({ phase: 'termsRequired', reason: 'update' });
    expect(reduceEntryFlow(required, { type: 'retry' })).toBe(required);
    expect(reduceEntryFlow(required, { type: 'termsAccepted' })).toEqual({
      phase: 'initializing',
      attempt: 1,
    });
  });

  it('同意状況を読めなければ、再試行で読み直す', () => {
    const unavailable = run([{ type: 'termsCheckFailed', error: 'boom' }]);
    expect(unavailable).toEqual({ phase: 'termsUnavailable', error: 'boom' });
    expect(reduceEntryFlow(unavailable, { type: 'retry' })).toEqual({
      phase: 'checkingTerms',
    });
  });

  it('初期化に成功したらギャラリーへ進む', () => {
    expect(
      run([{ type: 'initSucceeded', attempt: 1 }], {
        phase: 'initializing',
        attempt: 1,
      }),
    ).toEqual({ phase: 'ready' });
  });

  it('フォルダが見つからない失敗は初期設定へ、それ以外は失敗画面へ送る', () => {
    const initializing: EntryState = { phase: 'initializing', attempt: 1 };
    const setup = errorOf(ERROR_CATEGORIES.SETUP_REQUIRED);
    const database = errorOf(ERROR_CATEGORIES.DATABASE_ERROR);
    expect(
      run([{ type: 'initFailed', attempt: 1, error: setup }], initializing),
    ).toEqual({ phase: 'setupRequired', attempt: 1 });
    expect(
      run([{ type: 'initFailed', attempt: 1, error: database }], initializing),
    ).toEqual({ phase: 'initFailed', attempt: 1, error: database });
  });

  it('初期設定や失敗画面からの再試行は、次の試行として初期化し直す', () => {
    expect(
      run([{ type: 'retry' }], { phase: 'setupRequired', attempt: 1 }),
    ).toEqual({ phase: 'initializing', attempt: 2 });
    expect(
      run([{ type: 'retry' }], {
        phase: 'initFailed',
        attempt: 2,
        error: errorOf(ERROR_CATEGORIES.UNKNOWN_ERROR),
      }),
    ).toEqual({ phase: 'initializing', attempt: 3 });
  });

  it('前の試行の結果が後から届いても、今の試行は進めない', () => {
    const current: EntryState = { phase: 'initializing', attempt: 2 };
    expect(
      reduceEntryFlow(current, { type: 'initSucceeded', attempt: 1 }),
    ).toBe(current);
    expect(
      reduceEntryFlow(current, {
        type: 'initFailed',
        attempt: 1,
        error: errorOf(ERROR_CATEGORIES.UNKNOWN_ERROR),
      }),
    ).toBe(current);
  });

  it('ギャラリーに進んだ後は、起動の流れの出来事で戻らない', () => {
    const ready: EntryState = { phase: 'ready' };
    const events: EntryEvent[] = [
      { type: 'retry' },
      { type: 'termsAccepted' },
      { type: 'termsChecked', decision: { kind: 'required', reason: 'new' } },
      {
        type: 'initFailed',
        attempt: 1,
        error: errorOf(ERROR_CATEGORIES.UNKNOWN_ERROR),
      },
    ];
    for (const event of events) {
      expect(reduceEntryFlow(ready, event)).toBe(ready);
    }
  });
});

describe('hasConsented', () => {
  it('同意前の段階では false、初期化以降では true', () => {
    const before: EntryState[] = [
      { phase: 'checkingTerms' },
      { phase: 'termsUnavailable', error: null },
      { phase: 'termsRequired', reason: 'new' },
    ];
    const after: EntryState[] = [
      { phase: 'initializing', attempt: 1 },
      { phase: 'setupRequired', attempt: 1 },
      {
        phase: 'initFailed',
        attempt: 1,
        error: errorOf(ERROR_CATEGORIES.UNKNOWN_ERROR),
      },
      { phase: 'ready' },
    ];
    expect(before.map(hasConsented)).toEqual([false, false, false]);
    expect(after.map(hasConsented)).toEqual([true, true, true, true]);
  });
});
