import { describe, expect, test } from 'bun:test';
import { formatAge, padDisplay, shortModel, statusGlyph, textWidth, truncate, wrapLines } from '../src/tui/format';

describe('formatAge', () => {
  test('単位を切り替える', () => {
    const now = 1_000_000_000;
    expect(formatAge(now - 5_000, now)).toBe('5s');
    expect(formatAge(now - 61_000, now)).toBe('1m');
    expect(formatAge(now - 3_600_000 * 3, now)).toBe('3h');
    expect(formatAge(now - 86_400_000 * 2, now)).toBe('2d');
    expect(formatAge(null, now)).toBe('-');
  });
});

describe('truncate', () => {
  test('全角を 2 幅として数え、超えたら … を付ける', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('日本語です', 6)).toBe('日本…');
    expect(truncate(null, 4)).toBe('');
    expect(truncate('ab', 4)).toBe('ab');
  });
});

describe('padDisplay', () => {
  test('表示幅でパディングし、全角は 1 文字を 2 幅として数える', () => {
    expect(padDisplay('日本', 6)).toBe('日本  ');
    expect(padDisplay('ab', 4)).toBe('ab  ');
    expect(padDisplay('abcdef', 4)).toBe('abcdef');
  });
});

describe('wrapLines', () => {
  test('width を超える単語は表示幅で強制的に分割し、maxLines を超えたら最後の行を…で切る', () => {
    const lines = wrapLines('see ' + 'x'.repeat(200), 40, 3);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(40);
    expect(lines[lines.length - 1]).toMatch(/…$/);
  });
});

describe('statusGlyph', () => {
  test('状態ごとに 1 文字', () => {
    expect(statusGlyph('blocked')).toBe('⏸');
    expect(statusGlyph('done')).toBe('✔');
  });
});

describe('shortModel', () => {
  test('系列名だけに丸め、gpt- は 2 セグメント目まで残す', () => {
    expect(shortModel('claude-fable-5-1[1m]')).toBe('fable');
    expect(shortModel('opus[1m]')).toBe('opus');
    expect(shortModel('sonnet')).toBe('sonnet');
    expect(shortModel('gpt-5.6-sol')).toBe('gpt-5.6');
    expect(shortModel(null)).toBe('-');
  });
});
