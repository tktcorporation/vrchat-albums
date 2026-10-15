/**
 * docs ライフサイクル lint がパス指定に使う最小 glob マッチャ。
 *
 * 外部の glob ライブラリを入れない理由: 必要なのはディレクトリ配下の md を
 * 指す程度のパターンだけで、brace 展開や extglob は使わない。lint ツールは
 * ziku 経由で他リポジトリへ配布されるため、依存が少ないほど導入コストが下がる。
 *
 * サポートするのは `**`（0 階層以上のディレクトリ）・`*`（`/` を越えない任意文字列）・
 * `?`（`/` 以外の 1 文字）の 3 つだけ。それ以外の文字はリテラルとして扱う。
 */

/** 正規表現のメタ文字をリテラルとして扱えるようエスケープする */
function escapeRegExpChar(char: string): string {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

/**
 * glob パターンを、リポジトリルート相対パス全体に対して照合する正規表現へ変換する。
 *
 * `**` に続くスラッシュを `(?:[^/]+/)*` に落として 0 階層にもマッチさせる —
 * `docs` 配下を指すパターンで、サブディレクトリの doc だけでなく直下の doc も
 * 拾ってほしいため。
 */
export function globToRegExp(pattern: string): RegExp {
  let source = '';
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];

    if (char === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          source += '(?:[^/]+/)*';
          index += 3;
          continue;
        }
        source += '.*';
        index += 2;
        continue;
      }
      source += '[^/]*';
      index += 1;
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      index += 1;
      continue;
    }

    source += escapeRegExpChar(char);
    index += 1;
  }

  return new RegExp(`^${source}$`);
}

export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(path);
}

export function matchesAnyGlob(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesGlob(path, pattern));
}
