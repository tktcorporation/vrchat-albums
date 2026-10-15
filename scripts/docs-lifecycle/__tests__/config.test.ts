import { describe, expect, it } from 'bun:test';
import { parseConfig, resolveLifecycleByPath, staleDaysFor } from '../config.ts';

const MINIMAL = {
  scan: ['docs/**/*.md'],
  staleDays: { ephemeral: 7, durable: 60 },
};

describe('parseConfig', () => {
  it('必須項目だけの設定に既定値を埋める', () => {
    const config = parseConfig(MINIMAL);
    expect(config).toMatchObject({
      ignore: [],
      defaultLifecycle: 'durable',
      policies: [],
      referencePrefixes: [],
      referenceIgnoreFrom: [],
    });
  });

  it('トップレベルの未知のキーを拒否する（既定値で黙って検知が弱まらないようにする）', () => {
    expect(() => parseConfig({ ...MINIMAL, referencePrefixe: ['docs/'] })).toThrow(
      /referencePrefixe/,
    );
  });

  it('staleDays の未知のキーを拒否する', () => {
    expect(() =>
      parseConfig({ ...MINIMAL, staleDays: { ephemeral: 7, durable: 60, generated: 30 } }),
    ).toThrow(/generated/);
  });

  it('policy の未知のキーを拒否する', () => {
    expect(() =>
      parseConfig({
        ...MINIMAL,
        policies: [{ path: ['docs/plans/**'], lifecycle: 'ephemeral', why: '理由' }],
      }),
    ).toThrow();
  });

  it('問題のあるキーを列挙したメッセージを投げる', () => {
    expect(() => parseConfig({ scan: [], staleDays: { ephemeral: 0, durable: 60 } })).toThrow(
      /scan[\s\S]*staleDays\.ephemeral/,
    );
  });
});

describe('resolveLifecycleByPath', () => {
  const config = parseConfig({
    ...MINIMAL,
    defaultLifecycle: 'durable',
    policies: [
      { paths: ['docs/plans/**/*.md'], lifecycle: 'ephemeral', why: '使い捨ての設計メモ' },
      { paths: ['docs/**/*.md'], lifecycle: 'generated', why: '後ろの policy は優先されない' },
    ],
  });

  it('先にマッチした policy が優先される', () => {
    expect(resolveLifecycleByPath('docs/plans/a.md', config)).toBe('ephemeral');
  });

  it('どの policy にもマッチしなければ defaultLifecycle を使う', () => {
    expect(resolveLifecycleByPath('handbook/a.md', config)).toBe('durable');
  });
});

describe('staleDaysFor', () => {
  it('generated は鮮度チェックの対象外', () => {
    expect(staleDaysFor('generated', parseConfig(MINIMAL))).toBeNull();
  });

  it('lifecycle ごとの閾値を返す', () => {
    const config = parseConfig(MINIMAL);
    expect(staleDaysFor('ephemeral', config)).toBe(7);
    expect(staleDaysFor('durable', config)).toBe(60);
  });
});
