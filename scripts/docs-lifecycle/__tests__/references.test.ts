import { describe, expect, it } from 'bun:test';
import { buildReferenceIndex, buildReferencePattern, parseGitGrepMatches } from '../references.ts';

const PATTERN = buildReferencePattern(['docs/']);

describe('parseGitGrepMatches', () => {
  it('`path:line:content` から doc パス参照を抽出する', () => {
    const output = [
      'worker/src/db/schema.ts:7: * 根拠は docs/plans/schema-design.md を参照。',
      'infra/tofu/d1.tf:8:# 設計 doc: docs/design/storage.md',
    ].join('\n');

    expect(parseGitGrepMatches(output, PATTERN)).toEqual([
      { fromPath: 'worker/src/db/schema.ts', line: 7, target: 'docs/plans/schema-design.md' },
      { fromPath: 'infra/tofu/d1.tf', line: 8, target: 'docs/design/storage.md' },
    ]);
  });

  it('外部 URL に含まれるパスは参照として扱わない', () => {
    const output =
      '.changeset/README.md:8:[docs](https://github.com/example/repo/blob/main/docs/guide.md) を参照';
    expect(parseGitGrepMatches(output, PATTERN)).toEqual([]);
  });

  it('区切り文字の直後にある URL も除去する', () => {
    const output = 'worker/.env.example:1:DOCS_URL=https://example.com/docs/remote.md';
    expect(parseGitGrepMatches(output, PATTERN)).toEqual([]);
  });

  it('プロトコル相対 URL に含まれるパスも参照として扱わない', () => {
    const output = 'web/src/app.ts:3:// see //example.com/docs/remote.md';
    expect(parseGitGrepMatches(output, PATTERN)).toEqual([]);
  });

  it('スラッシュを挟まない URI に含まれるパスも参照として扱わない', () => {
    for (const line of [
      'worker/src/x.ts:3:// mailto:user@example.com?body=docs/retired.md',
      'worker/src/x.ts:3:// data:text/plain,docs/retired.md',
      'worker/src/x.ts:3:// urn:example:docs/retired.md',
    ]) {
      expect(parseGitGrepMatches(line, PATTERN)).toEqual([]);
    }
  });

  it('file:line 表記をスキームと誤認して参照を消さない', () => {
    const output = 'worker/src/x.ts:3: * 詳細は docs/plans/a.md:12 と Makefile:12:docs/design/x.md';
    expect(parseGitGrepMatches(output, PATTERN).map((r) => r.target)).toEqual([
      'docs/plans/a.md',
      'docs/design/x.md',
    ]);
  });

  it('参照の直後に続くコロン付きの見出し名で参照を消さない', () => {
    const output = 'worker/src/x.ts:3: * 参照: docs/design/x.md:設計方針';
    expect(parseGitGrepMatches(output, PATTERN).map((r) => r.target)).toEqual(['docs/design/x.md']);
  });

  it('パス内の連続スラッシュを URL と誤認しない', () => {
    const output = 'worker/src/x.ts:3: * 参照: docs//design/x.md';
    expect(parseGitGrepMatches(output, PATTERN).map((r) => r.target)).toEqual([
      'docs//design/x.md',
    ]);
  });

  it('同じ行に複数の参照があれば全部拾う', () => {
    const output = 'docs/plans/a.md:3:関連: docs/design/x.md と docs/design/y.md';
    expect(parseGitGrepMatches(output, PATTERN).map((reference) => reference.target)).toEqual([
      'docs/design/x.md',
      'docs/design/y.md',
    ]);
  });

  it('空行を無視する', () => {
    expect(parseGitGrepMatches('\n\n', PATTERN)).toEqual([]);
  });

  it('行番号を持たない行を無視する', () => {
    expect(parseGitGrepMatches('壊れた出力', PATTERN)).toEqual([]);
  });
});

describe('buildReferencePattern', () => {
  it('接頭辞のドットをワイルドカードとして解釈しない', () => {
    const pattern = buildReferencePattern(['do.s/']);
    expect('docs/a.md'.match(pattern)).toBeNull();
    expect('do.s/a.md'.match(pattern)).not.toBeNull();
  });

  it('別のディレクトリの途中から接頭辞を切り出さない', () => {
    const pattern = buildReferencePattern(['docs/']);
    expect(
      parseGitGrepMatches('a.ts:1: // see vendor/docs/guide.md', pattern).map((r) => r.target),
    ).toEqual([]);
    expect(
      parseGitGrepMatches('a.ts:1: // see my-docs/guide.md', pattern).map((r) => r.target),
    ).toEqual([]);
  });

  it('区切り文字に囲まれた参照は拾う', () => {
    const pattern = buildReferencePattern(['docs/']);
    for (const line of [
      'a.ts:1: // see docs/guide.md',
      'a.ts:1: // see (docs/guide.md)',
      'a.ts:1:"docs/guide.md"',
      'docs/guide.md:1:docs/guide.md',
    ]) {
      expect(parseGitGrepMatches(line, pattern).map((r) => r.target)).toEqual(['docs/guide.md']);
    }
  });

  it('拡張子の直後にパスが続くものは参照として扱わない', () => {
    const pattern = buildReferencePattern(['docs/']);
    for (const line of [
      'a.ts:1: // docs/retired.md.template',
      'a.ts:1: // docs/retired.mdx.bak',
      'a.ts:1: // docs/retired.md/inner.txt',
    ]) {
      expect(parseGitGrepMatches(line, pattern).map((r) => r.target)).toEqual([]);
    }
  });

  it('mdx をそのまま拾う', () => {
    const pattern = buildReferencePattern(['docs/']);
    expect(
      parseGitGrepMatches('a.ts:1: // docs/guide.mdx を参照', pattern).map((r) => r.target),
    ).toEqual(['docs/guide.mdx']);
  });

  it('非 ASCII のファイル名にマッチする', () => {
    const output = 'worker/src/x.ts:3: * 設計は docs/plans/繰り返し予定.md を参照。';
    expect(parseGitGrepMatches(output, buildReferencePattern(['docs/']))).toEqual([
      { fromPath: 'worker/src/x.ts', line: 3, target: 'docs/plans/繰り返し予定.md' },
    ]);
  });
});

describe('buildReferenceIndex', () => {
  it('参照先ごとに参照元をまとめる', () => {
    const index = buildReferenceIndex([
      { fromPath: 'a.ts', line: 1, target: 'docs/design/x.md' },
      { fromPath: 'b.ts', line: 2, target: 'docs/design/x.md' },
      { fromPath: 'c.ts', line: 3, target: 'docs/design/y.md' },
    ]);

    expect(index.get('docs/design/x.md')).toHaveLength(2);
    expect(index.get('docs/design/y.md')).toHaveLength(1);
    expect(index.get('docs/design/z.md')).toBeUndefined();
  });
});
