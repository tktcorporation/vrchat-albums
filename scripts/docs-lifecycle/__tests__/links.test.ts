import { describe, expect, it } from 'bun:test';
import { extractMarkdownLinks, isExternalTarget, resolveLinkTarget } from '../links.ts';

describe('extractMarkdownLinks', () => {
  it('インラインリンクを行番号付きで抽出する', () => {
    const content = ['# 見出し', '', '詳細は [設計](./design.md) を参照。'].join('\n');
    expect(extractMarkdownLinks(content)).toEqual([{ line: 3, target: './design.md' }]);
  });

  it('1 行に複数のリンクがあっても全部抽出する', () => {
    const links = extractMarkdownLinks('[a](./a.md) と [b](../b.md)');
    expect(links.map((link) => link.target)).toEqual(['./a.md', '../b.md']);
  });

  it('リンクタイトル付きの記法を扱える', () => {
    expect(extractMarkdownLinks('[a](./a.md "タイトル")')).toEqual([{ line: 1, target: './a.md' }]);
  });

  it('リンク先に含まれる括弧のペアを切り落とさない', () => {
    expect(extractMarkdownLinks('[guide](./foo_(bar).md)')).toEqual([
      { line: 1, target: './foo_(bar).md' },
    ]);
  });

  it('山括弧で囲まれたリンク先を扱える', () => {
    expect(extractMarkdownLinks('[a](<./a b.md>)')).toEqual([{ line: 1, target: './a b.md' }]);
  });

  it('参照定義リンクを抽出する', () => {
    expect(extractMarkdownLinks('[label]: ./design.md')).toEqual([
      { line: 1, target: './design.md' },
    ]);
  });

  it('参照定義リンクの山括弧内のスペースを保つ', () => {
    expect(extractMarkdownLinks('[guide]: <./file name.md>')).toEqual([
      { line: 1, target: './file name.md' },
    ]);
  });

  it('frontmatter 内の Markdown 風テキストをリンクとして扱わない', () => {
    const content = [
      '---',
      'description: "[guide](./not-real.md)"',
      'lifecycle: durable',
      '---',
      '',
      '本文の [実物](./real.md)',
    ].join('\n');
    expect(extractMarkdownLinks(content)).toEqual([{ line: 6, target: './real.md' }]);
  });

  it('ブロックスカラー内の `---` より後ろの frontmatter を本文として扱わない', () => {
    const content = [
      '---',
      'description: |',
      '  ---',
      'review-reason: "[偽物](./not-real.md)"',
      '---',
      '',
      '本文の [実物](./real.md)',
    ].join('\n');
    expect(extractMarkdownLinks(content)).toEqual([{ line: 7, target: './real.md' }]);
  });

  it('閉じられていない frontmatter は本文として扱う（行番号を保つ）', () => {
    const content = ['---', 'まだ閉じていない', '', '[実物](./real.md)'].join('\n');
    expect(extractMarkdownLinks(content)).toEqual([{ line: 4, target: './real.md' }]);
  });

  it('コードフェンス内のリンクは無視する', () => {
    const content = ['```md', '[サンプル](./not-real.md)', '```', '[本物](./real.md)'].join('\n');
    expect(extractMarkdownLinks(content)).toEqual([{ line: 4, target: './real.md' }]);
  });

  it('4 連フェンスの中の 3 連フェンスでは閉じない', () => {
    const content = [
      '````md',
      '```',
      '[サンプル](./not-real.md)',
      '```',
      '````',
      '[本物](./real.md)',
    ].join('\n');
    expect(extractMarkdownLinks(content)).toEqual([{ line: 6, target: './real.md' }]);
  });

  it('同じ長さでも info string が付く行では閉じない（閉じフェンスに info string は書けない）', () => {
    const content = [
      '````md',
      '````typescript',
      '[サンプル](./not-real.md)',
      '````',
      '[本物](./real.md)',
    ].join('\n');
    expect(extractMarkdownLinks(content)).toEqual([{ line: 5, target: './real.md' }]);
  });

  it('エスケープされたバッククォートはコードスパンを作らない（リンクとして扱う）', () => {
    expect(extractMarkdownLinks('\\`[guide](./real.md)\\`')).toEqual([
      { line: 1, target: './real.md' },
    ]);
  });

  it('indented code block 内のリンクは無視する', () => {
    const content = ['段落', '', '    [サンプル](./not-real.md)', '', '[本物](./real.md)'].join(
      '\n',
    );
    expect(extractMarkdownLinks(content)).toEqual([{ line: 5, target: './real.md' }]);
  });

  it('リスト項目の継続段落にあるリンクは読み飛ばさない', () => {
    const content = ['- 項目', '', '    [本物](./real.md)'].join('\n');
    expect(extractMarkdownLinks(content)).toEqual([{ line: 3, target: './real.md' }]);
  });

  it('info string にバッククォートを含む行はフェンスを開かない', () => {
    const content = ['```lang`name', '[本物](./real.md)'].join('\n');
    expect(extractMarkdownLinks(content)).toEqual([{ line: 2, target: './real.md' }]);
  });

  it('チルダのコードフェンスも無視する', () => {
    const content = ['~~~', '[サンプル](./not-real.md)', '~~~'].join('\n');
    expect(extractMarkdownLinks(content)).toEqual([]);
  });

  it('インラインコード内のリンクは無視する', () => {
    expect(extractMarkdownLinks('`[サンプル](./not-real.md)` は例')).toEqual([]);
  });

  it('2 連バッククォートのコードスパン内のリンクも無視する', () => {
    expect(extractMarkdownLinks('``[サンプル](./not-real.md)`` は例')).toEqual([]);
  });

  it('デリミタの長さが違えばコードスパンにならない（リンクとして扱う）', () => {
    expect(extractMarkdownLinks('``[guide](./real.md)```')).toEqual([
      { line: 1, target: './real.md' },
    ]);
  });

  it('4 スペース以上インデントされた行はフェンスを開かない', () => {
    const content = ['    ```', '[本物](./real.md)'].join('\n');
    expect(extractMarkdownLinks(content)).toEqual([{ line: 2, target: './real.md' }]);
  });

  it('3 スペースまでのインデントはフェンスとして扱う', () => {
    const content = ['   ```', '[サンプル](./not-real.md)', '   ```'].join('\n');
    expect(extractMarkdownLinks(content)).toEqual([]);
  });
});

describe('isExternalTarget', () => {
  it('スキーム付き URL とプロトコル相対を外部と判定する', () => {
    expect(isExternalTarget('https://example.com/a.md')).toBe(true);
    expect(isExternalTarget('mailto:someone@example.com')).toBe(true);
    expect(isExternalTarget('//example.com/a.md')).toBe(true);
  });

  it('相対パスは外部ではない', () => {
    expect(isExternalTarget('./design.md')).toBe(false);
    expect(isExternalTarget('../design.md')).toBe(false);
  });
});

describe('resolveLinkTarget', () => {
  it('doc からの相対パスをリポジトリルート相対に解決する', () => {
    expect(resolveLinkTarget('docs/plans/plan.md', './design.md')).toEqual({
      kind: 'repo-path',
      path: 'docs/plans/design.md',
    });
    expect(resolveLinkTarget('docs/plans/plan.md', '../design/scope.md')).toEqual({
      kind: 'repo-path',
      path: 'docs/design/scope.md',
    });
  });

  it('先頭スラッシュはリポジトリルート起点として扱う', () => {
    expect(resolveLinkTarget('docs/plans/plan.md', '/docs/design/scope.md')).toEqual({
      kind: 'repo-path',
      path: 'docs/design/scope.md',
    });
  });

  it('アンカーとクエリを落としてから解決する', () => {
    expect(resolveLinkTarget('docs/plans/plan.md', './design.md#section-5')).toEqual({
      kind: 'repo-path',
      path: 'docs/plans/design.md',
    });
  });

  it('同一ドキュメント内アンカーは検証対象外', () => {
    expect(resolveLinkTarget('docs/plans/plan.md', '#section-5')).toEqual({
      kind: 'not-checkable',
    });
  });

  it('外部 URL は検証対象外', () => {
    expect(resolveLinkTarget('docs/plans/plan.md', 'https://example.com')).toEqual({
      kind: 'not-checkable',
    });
  });

  it('パーセントエンコードされたパスをデコードする', () => {
    expect(resolveLinkTarget('docs/plans/plan.md', './a%20b.md')).toEqual({
      kind: 'repo-path',
      path: 'docs/plans/a b.md',
    });
  });

  it('リポジトリ外へ出るリンクを repo-path として返さない', () => {
    expect(resolveLinkTarget('docs/a.md', '../../../etc/passwd')).toEqual({
      kind: 'outside-repo',
    });
    expect(resolveLinkTarget('docs/plans/a.md', '../../..')).toEqual({ kind: 'outside-repo' });
  });
});
