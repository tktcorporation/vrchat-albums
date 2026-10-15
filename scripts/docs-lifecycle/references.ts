/**
 * リポジトリ全文から「doc へのパス参照」を集める。
 *
 * 2 つの目的を兼ねる:
 *   1. 削除済み doc を指したままの参照（コードコメント・他 doc）を検知する
 *   2. stale な doc に参照元があるかを示し、削除するか WHY を退避するかの判断材料にする
 *
 * ここが見るのは「行のテキスト」で、パスの境界を示す構文が無い。doc 内の
 * Markdown リンクは links.ts がパーサで正確に扱うが、コードコメントに書かれた
 * 裸のパスは空白で区切られている前提でしか切り出せない。その帰結として、
 * 次のケースは検知できない:
 *
 *   - 空白を含むパス（`docs/foo bar.md`）— 区切りを緩めると散文や glob を巻き込む
 *   - 外部 URL と空白なしで隣接する参照（`URL=https://…/docs/a.md;DOC=docs/b.md`）
 *     — URL の終端を決める構文が行内に無く、狭めると URL 内のパスを誤検知する
 *   - `§5.2` のようにファイル名を伴わない参照（`.claude/rules/doc-placement.md`）
 *
 * いずれも「拾えないと見逃す」側に倒れる。誤検知（実在する参照を壊れていると
 * 報告して CI を落とす）より軽い失敗として、この範囲で止めている。
 */

export interface DocReference {
  /** 参照している側のファイル（リポジトリルート相対） */
  fromPath: string;
  line: number;
  /** 参照先の doc パス（リポジトリルート相対） */
  target: string;
}

/** `git grep -n` の 1 行 `path:line:content` を分解する */
const GREP_LINE_PATTERN = /^(.+?):(\d+):(.*)$/;

/**
 * 外部 URI。`https://example.com/docs/x.md` のような階層形式に限らず、
 * `mailto:…?body=docs/x.md` や `data:text/plain,docs/x.md` のようにスラッシュを
 * 挟まない形式も、中に現れるパスはローカル doc の参照ではない。
 *
 * 空白区切りのトークン単位で落とす。行のテキストには URI の終端を示す構文が
 * 無いので、区切り文字を数え上げる方式は必ず漏れる。
 *
 * 2 つのガードで、URI ではないコロン付きの表記を巻き込まないようにする。
 *   - 直前がパスを構成する文字でないこと — doc パスの直後にコロンで見出し名を
 *     続けた表記で、末尾の `<拡張子>:` をスキームと誤認し、参照の後半ごと
 *     消してしまわないため。同時に、パス内でスラッシュが連続した箇所を
 *     プロトコル相対 URI と誤認することも防ぐ
 *   - コロンの直後が数字でないこと — `Makefile:12:…` のような file:line 表記を
 *     スキームと誤認しないため
 */
const EXTERNAL_URI_PATTERN = /(?<![A-Za-z0-9._/-])(?:[A-Za-z][A-Za-z0-9+.-]*:(?![0-9])|\/\/)\S*/g;

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 設定の接頭辞（例: `docs/`）から、doc パスらしき文字列にマッチする正規表現を作る。
 *
 * 接頭辞の直前がパスを構成する文字でないことを要求する。これが無いと、接頭辞を
 * 途中に含む別のパス（ベンダーディレクトリ配下や、接頭辞で終わる名前のディレクトリ）
 * から接頭辞以降だけを切り出し、ルート直下には無い実在しないパスとして誤報告する。
 *
 * ASCII だけでなく Unicode の文字・数字を許すのは、日本語ファイル名の doc を
 * 削除したときに、残った参照を検知できるようにするため。
 */
export function buildReferencePattern(prefixes: readonly string[]): RegExp {
  const alternatives = prefixes.map(escapeForRegExp).join('|');
  const pathChar = '[\\p{L}\\p{N}_./-]';
  // 拡張子の直後にもパス構成文字が続かないことを要求する。これが無いと
  // `.md` を途中に含む別のファイル（テンプレートやバックアップ）から
  // 拡張子までを切り出し、実在しないパスとして誤報告する。
  return new RegExp(`(?<!${pathChar})(?:${alternatives})${pathChar}*\\.mdx?(?!${pathChar})`, 'gu');
}

/**
 * git grep の出力から doc パス参照を取り出す。
 *
 * マッチ部分だけを返す `-o` ではなく行全体を受け取るのは、外部 URL に含まれる
 * `docs/...` を除くため。`-o` だと周囲の文脈が失われ、`https://example.com/docs/x.md`
 * のようなリンクがローカルの参照残骸として誤報告される。
 */
export function parseGitGrepMatches(output: string, pattern: RegExp): DocReference[] {
  const references: DocReference[] = [];

  for (const line of output.split('\n')) {
    if (line.length === 0) continue;
    const match = line.match(GREP_LINE_PATTERN);
    if (!match) continue;

    const [, fromPath, rawLine, content] = match;
    const withoutUrls = content.replace(EXTERNAL_URI_PATTERN, ' ');
    for (const found of withoutUrls.matchAll(pattern)) {
      references.push({ fromPath, line: Number.parseInt(rawLine, 10), target: found[0] });
    }
  }

  return references;
}

/** 参照先ごとに参照元をまとめる。stale レポートの補助情報に使う */
export function buildReferenceIndex(
  references: readonly DocReference[],
): Map<string, DocReference[]> {
  const index = new Map<string, DocReference[]>();
  for (const reference of references) {
    const existing = index.get(reference.target);
    if (existing) {
      existing.push(reference);
      continue;
    }
    index.set(reference.target, [reference]);
  }
  return index;
}
