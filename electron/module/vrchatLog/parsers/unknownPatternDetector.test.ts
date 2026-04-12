import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VRChatLogLine } from '../model';
import {
  _resetReportedSkeletons,
  detectAndReportUnknownPatterns,
  detectUnknownPatterns,
  extractPatternSkeleton,
} from './unknownPatternDetector';

vi.mock('../../../lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/** テスト用ヘルパー: 文字列を VRChatLogLine として扱う */
const asLogLine = (line: string) => line as VRChatLogLine;

describe('extractPatternSkeleton', () => {
  it('[Behaviour] 直後の動作名を抽出する', () => {
    const line =
      '2024.01.15 12:34:56 Log - [Behaviour] OnPlayerJoined Alice (usr_xxx)';
    expect(extractPatternSkeleton(asLogLine(line))).toBe(
      '[Behaviour] OnPlayerJoined',
    );
  });

  it('Joining パターンの骨格を抽出する', () => {
    const line =
      '2024.01.15 12:34:56 Log - [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789012:12345~hidden(usr_xxx)';
    expect(extractPatternSkeleton(asLogLine(line))).toBe('[Behaviour] Joining');
  });

  it('未知のパターンの骨格を抽出する', () => {
    const line =
      '2024.01.15 12:34:56 Log - [Behaviour] OnGroupInvite someGroup';
    expect(extractPatternSkeleton(asLogLine(line))).toBe(
      '[Behaviour] OnGroupInvite',
    );
  });

  it('[Behaviour] が含まれない行は PII を含まないプレースホルダーを返す', () => {
    const line = '2024.01.15 12:34:56 Log - Something else entirely';
    expect(extractPatternSkeleton(asLogLine(line))).toBe(
      '[Behaviour] <unparsed>',
    );
  });
});

describe('detectUnknownPatterns', () => {
  it('既知パターンのみの場合は空のサマリを返す', () => {
    const lines = [
      '2024.01.15 12:34:56 Log - [Behaviour] OnPlayerJoined Alice (usr_xxx)',
      '2024.01.15 12:34:57 Log - [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789012:12345',
      '2024.01.15 12:34:58 Log - [Behaviour] OnPlayerLeft Bob (usr_yyy)',
      '2024.01.15 12:34:59 Log - [Behaviour] Joining or Creating Room: Test World',
    ].map((line) => asLogLine(line));

    const result = detectUnknownPatterns(lines);
    expect(result.totalCount).toBe(0);
    expect(result.uniquePatterns).toHaveLength(0);
  });

  it('未知のパターンを検出する', () => {
    const lines = [
      '2024.01.15 12:34:56 Log - [Behaviour] OnPlayerJoined Alice (usr_xxx)',
      '2024.01.15 12:34:57 Log - [Behaviour] OnGroupInvite someGroup',
      '2024.01.15 12:35:00 Log - [Behaviour] OnGroupInvite anotherGroup',
    ].map((line) => asLogLine(line));

    const result = detectUnknownPatterns(lines);
    expect(result.totalCount).toBe(2);
    expect(result.uniquePatterns).toEqual(['[Behaviour] OnGroupInvite']);
  });

  it('[Behaviour] を含まない行は無視する', () => {
    const lines = [
      '2024.01.15 12:34:56 Log - [Network] Something happened',
      '2024.01.15 12:34:57 Log - VRC Analytics Initialized',
    ].map((line) => asLogLine(line));

    const result = detectUnknownPatterns(lines);
    expect(result.totalCount).toBe(0);
    expect(result.uniquePatterns).toHaveLength(0);
  });

  it('複数の未知パターンをそれぞれ検出する', () => {
    const lines = [
      '2024.01.15 12:34:56 Log - [Behaviour] OnGroupInvite someGroup',
      '2024.01.15 12:34:57 Log - [Behaviour] OnAvatarChanged avatar_xxx',
      '2024.01.15 12:34:58 Log - [Behaviour] OnGroupInvite anotherGroup',
    ].map((line) => asLogLine(line));

    const result = detectUnknownPatterns(lines);
    expect(result.totalCount).toBe(3);
    expect(result.uniquePatterns).toHaveLength(2);
    expect(result.uniquePatterns).toContain('[Behaviour] OnGroupInvite');
    expect(result.uniquePatterns).toContain('[Behaviour] OnAvatarChanged');
  });
});

describe('detectAndReportUnknownPatterns', () => {
  beforeEach(() => {
    _resetReportedSkeletons();
    vi.clearAllMocks();
  });

  it('未知パターンがない場合はログを出力しない', async () => {
    const { logger } = await import('../../../lib/logger');
    const lines = [
      '2024.01.15 12:34:56 Log - [Behaviour] OnPlayerJoined Alice (usr_xxx)',
    ].map((line) => asLogLine(line));

    detectAndReportUnknownPatterns(lines);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('未知パターンがある場合は warn と error を出力する', async () => {
    const { logger } = await import('../../../lib/logger');
    const lines = [
      '2024.01.15 12:34:56 Log - [Behaviour] OnGroupInvite someGroup',
    ].map((line) => asLogLine(line));

    detectAndReportUnknownPatterns(lines);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          uniquePatterns: ['[Behaviour] OnGroupInvite'],
          totalCount: 1,
        }),
      }),
    );
  });

  it('同一パターンを2回目の呼び出しで再送信しない', async () => {
    const { logger } = await import('../../../lib/logger');
    const lines = [
      '2024.01.15 12:34:56 Log - [Behaviour] OnGroupInvite someGroup',
    ].map((line) => asLogLine(line));

    detectAndReportUnknownPatterns(lines);
    expect(logger.error).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();

    // 同じパターンで2回目の呼び出し → 送信されない
    detectAndReportUnknownPatterns(lines);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('新しいパターンが追加された場合は新規分のみ送信する', async () => {
    const { logger } = await import('../../../lib/logger');

    // 1回目: OnGroupInvite
    detectAndReportUnknownPatterns(
      ['2024.01.15 12:34:56 Log - [Behaviour] OnGroupInvite someGroup'].map(
        (line) => asLogLine(line),
      ),
    );
    expect(logger.error).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();

    // 2回目: OnGroupInvite（既知） + OnAvatarChanged（新規）
    detectAndReportUnknownPatterns(
      [
        '2024.01.15 12:35:00 Log - [Behaviour] OnGroupInvite anotherGroup',
        '2024.01.15 12:35:01 Log - [Behaviour] OnAvatarChanged avatar_xxx',
      ].map((line) => asLogLine(line)),
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          uniquePatterns: ['[Behaviour] OnAvatarChanged'],
        }),
      }),
    );
  });

  it('Sentry 送信上限（3回）を超えたら error ではなく warn に降格する', async () => {
    const { logger } = await import('../../../lib/logger');

    // 異なるパターンで3回送信 → 全て error
    for (let i = 0; i < 3; i++) {
      vi.clearAllMocks();
      detectAndReportUnknownPatterns(
        [`2024.01.15 12:34:5${i} Log - [Behaviour] Pattern${i} data`].map(
          (line) => asLogLine(line),
        ),
      );
      expect(logger.error).toHaveBeenCalledTimes(1);
    }

    vi.clearAllMocks();

    // 4回目 → error は呼ばれず warn のみ
    detectAndReportUnknownPatterns(
      ['2024.01.15 12:35:00 Log - [Behaviour] Pattern3 data'].map((line) =>
        asLogLine(line),
      ),
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Sentry report suppressed'),
    );
  });
});

describe('detectUnknownPatterns - ノイズパターン除外', () => {
  it('Sanity check パターンは既知として除外される', () => {
    const lines = [
      '2025.06.22 10:49:18 Debug - [Behaviour] Sanity check passed for ID: 1, Path: 386',
      '2025.06.22 10:49:19 Debug - [Behaviour] Sanity check passed for ID: 2, Path: 500',
    ].map((line) => asLogLine(line));

    const result = detectUnknownPatterns(lines);
    expect(result.totalCount).toBe(0);
    expect(result.uniquePatterns).toHaveLength(0);
  });

  it('Avatar Expression Parameter パターンは既知として除外される', () => {
    const lines = [
      "2026.01.01 00:39:01 Error - [Behaviour] Avatar Expression Parameter 'GestureLeft' duplicate definition",
      "2026.01.01 00:39:02 Error - [Behaviour] Avatar Expression Parameter 'GestureRight' duplicate definition",
    ].map((line) => asLogLine(line));

    const result = detectUnknownPatterns(lines);
    expect(result.totalCount).toBe(0);
    expect(result.uniquePatterns).toHaveLength(0);
  });

  it('変数部分が異なっても同じパターンとして除外される', () => {
    const lines = [
      '2025.06.22 10:49:18 Debug - [Behaviour] Sanity check passed for ID: 99, Path: 1234',
      "2026.03.15 12:00:00 Error - [Behaviour] Avatar Expression Parameter 'VRCEmote' duplicate definition",
    ].map((line) => asLogLine(line));

    const result = detectUnknownPatterns(lines);
    expect(result.totalCount).toBe(0);
    expect(result.uniquePatterns).toHaveLength(0);
  });
});
