import { describe, expect, it } from 'vitest';
import type { VRChatLogLine } from '../model';
import {
  detectUnknownPatterns,
  extractPatternSkeleton,
} from './unknownPatternDetector';

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

  it('[Behaviour] が含まれない行はフォールバックとして行全体を返す', () => {
    const line = '2024.01.15 12:34:56 Log - Something else entirely';
    expect(extractPatternSkeleton(asLogLine(line))).toBe(line);
  });
});

describe('detectUnknownPatterns', () => {
  it('既知パターンのみの場合は空のサマリを返す', () => {
    const lines = [
      '2024.01.15 12:34:56 Log - [Behaviour] OnPlayerJoined Alice (usr_xxx)',
      '2024.01.15 12:34:57 Log - [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789012:12345',
      '2024.01.15 12:34:58 Log - [Behaviour] OnPlayerLeft Bob (usr_yyy)',
      '2024.01.15 12:34:59 Log - [Behaviour] Joining or Creating Room: Test World',
    ].map(asLogLine);

    const result = detectUnknownPatterns(lines);
    expect(result.totalCount).toBe(0);
    expect(result.uniquePatterns).toHaveLength(0);
  });

  it('未知のパターンを検出する', () => {
    const lines = [
      '2024.01.15 12:34:56 Log - [Behaviour] OnPlayerJoined Alice (usr_xxx)',
      '2024.01.15 12:34:57 Log - [Behaviour] OnGroupInvite someGroup',
      '2024.01.15 12:35:00 Log - [Behaviour] OnGroupInvite anotherGroup',
    ].map(asLogLine);

    const result = detectUnknownPatterns(lines);
    expect(result.totalCount).toBe(2);
    expect(result.uniquePatterns).toEqual(['[Behaviour] OnGroupInvite']);
  });

  it('[Behaviour] を含まない行は無視する', () => {
    const lines = [
      '2024.01.15 12:34:56 Log - [Network] Something happened',
      '2024.01.15 12:34:57 Log - VRC Analytics Initialized',
    ].map(asLogLine);

    const result = detectUnknownPatterns(lines);
    expect(result.totalCount).toBe(0);
    expect(result.uniquePatterns).toHaveLength(0);
  });

  it('複数の未知パターンをそれぞれ検出する', () => {
    const lines = [
      '2024.01.15 12:34:56 Log - [Behaviour] OnGroupInvite someGroup',
      '2024.01.15 12:34:57 Log - [Behaviour] OnAvatarChanged avatar_xxx',
      '2024.01.15 12:34:58 Log - [Behaviour] OnGroupInvite anotherGroup',
    ].map(asLogLine);

    const result = detectUnknownPatterns(lines);
    expect(result.totalCount).toBe(3);
    expect(result.uniquePatterns).toHaveLength(2);
    expect(result.uniquePatterns).toContain('[Behaviour] OnGroupInvite');
    expect(result.uniquePatterns).toContain('[Behaviour] OnAvatarChanged');
  });
});
