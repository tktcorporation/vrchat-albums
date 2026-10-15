/**
 * md 内の相対リンク抽出と解決。doc を削除したときにリンク切れを残さないためのチェック。
 *
 * `.claude/rules/doc-placement.md` は「plan / spec を削除する前に参照箇所を手当てする」
 * 手順を定めている。手当て漏れを人力レビューではなく lint で検知するのがここの役割。
 *
 * Markdown パーサに委ねる理由: 「本文のリンク」と「コード例の中の文字列」を分けるには、
 * フェンス・コードスパン・エスケープといった CommonMark の構文規則がまるごと要る。
 * 行ベースで近似すると、規則の抜けが「サンプルの架空パスを実在チェックして CI を
 * 落とす」「本物のリンクを読み飛ばしてリンク切れを見逃す」の両方向で出続ける。
 */

/// <reference types="node" />

import { posix } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { visit } from 'unist-util-visit';
import { stripFrontmatter } from './frontmatter.ts';

export interface ExtractedLink {
  /** 1-indexed。エディタと CI ログの行番号表記に合わせる */
  line: number;
  target: string;
}

/**
 * リンク先が外部リソース（URL・mailto など）かどうか。スキーム付き、または
 * プロトコル相対 `//host` を外部と見なす。
 */
export function isExternalTarget(target: string): boolean {
  return /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(target);
}

/**
 * doc 内のリンクを抽出する。
 *
 * インラインリンク（`[text](target)`）・参照定義（`[label]: target`）・画像の
 * いずれも対象。コードブロックとコードスパンはパーサが別ノードとして扱うため、
 * サンプルコードに書かれた架空のパスはここに現れない。
 *
 * frontmatter は本文ではないので先に落とす。メタデータの値に Markdown 風の
 * 文字列が入っていても、それはリンクとして描画されない。
 */
export function extractMarkdownLinks(content: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const tree = fromMarkdown(stripFrontmatter(content));

  visit(tree, ['link', 'image', 'definition'], (node) => {
    if (!('url' in node) || typeof node.url !== 'string') return;
    const line = node.position?.start.line;
    if (line === undefined) return;
    links.push({ line, target: node.url });
  });

  return links;
}

export type ResolvedLinkTarget =
  /** リポジトリルート相対パス。存在チェックにかける */
  | { kind: 'repo-path'; path: string }
  /** 外部 URL・同一ドキュメント内アンカー。存在チェックの対象外 */
  | { kind: 'not-checkable' }
  /** `../` を辿ってリポジトリの外へ出るリンク。リポジトリ内のリンクとして成立しない */
  | { kind: 'outside-repo' };

/**
 * リンク先をリポジトリルート相対パスへ解決する。
 *
 * リポジトリ外へ出るパスを `repo-path` として返さないのは、そのまま存在チェックへ
 * 回すと実行環境のファイルシステム（CI ランナーの `/etc/...` など）を見て
 * 「リンク切れではない」と誤判定するため。
 */
export function resolveLinkTarget(docPath: string, target: string): ResolvedLinkTarget {
  if (isExternalTarget(target)) return { kind: 'not-checkable' };

  const withoutFragment = target.split('#')[0].split('?')[0];
  if (withoutFragment.length === 0) return { kind: 'not-checkable' };

  let decoded = withoutFragment;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    // 不正なパーセントエンコードはそのまま扱う（存在チェックで落ちる）
  }

  const normalized = decoded.startsWith('/')
    ? posix.normalize(decoded.slice(1))
    : posix.normalize(posix.join(posix.dirname(docPath), decoded));

  if (normalized === '..' || normalized.startsWith('../')) return { kind: 'outside-repo' };
  return { kind: 'repo-path', path: normalized };
}
