/**
 * 違反の整形。何が悪いかと同じ行に「次に何をするか」を出す。
 *
 * 対処の選択肢を違反ごとに繰り返さず末尾へ 1 回まとめるのは、違反件数が多い
 * 初回導入時に本体のリストが埋もれるのを避けるため。
 */

import type { AnalyzeResult, DocStatus, Violation } from './analyze.ts';
import type { DocReference } from './references.ts';

const MAX_SHOWN_REFERENCES = 5;

function formatReferences(references: readonly DocReference[]): string {
  if (references.length === 0) return '参照元なし（誰からも辿られていない）';

  const shown = references
    .slice(0, MAX_SHOWN_REFERENCES)
    .map((reference) => `${reference.fromPath}:${reference.line}`)
    .join(', ');
  const rest = references.length - MAX_SHOWN_REFERENCES;
  return rest > 0 ? `参照元: ${shown} ほか ${rest} 件` : `参照元: ${shown}`;
}

export function formatViolation(violation: Violation): string {
  switch (violation.kind) {
    case 'invalid-frontmatter':
      return [
        `[frontmatter] ${violation.path}`,
        ...violation.problems.map((problem) => `    ${problem}`),
      ].join('\n');
    case 'stale':
      return [
        `[stale] ${violation.path}`,
        `    ${violation.lifecycle} / 最終更新から ${violation.ageDays} 日（上限 ${violation.limitDays} 日）`,
        `    ${formatReferences(violation.referencedBy)}`,
      ].join('\n');
    case 'grace-expired':
      return [
        `[review-expired] ${violation.path}`,
        `    review-by: ${violation.until} を過ぎています`,
        `    ${formatReferences(violation.referencedBy)}`,
      ].join('\n');
    case 'broken-link':
      return `[broken-link] ${violation.path}:${violation.line} → ${violation.target}（参照先が存在しません）`;
    case 'dangling-reference':
      return `[dangling-ref] ${violation.fromPath}:${violation.line} → ${violation.target}（削除済み doc を参照しています）`;
    default: {
      const exhaustive: never = violation;
      throw new Error(`未知の violation です: ${JSON.stringify(exhaustive)}`);
    }
  }
}

const REMEDIES: Record<Violation['kind'], readonly string[]> = {
  stale: [
    '実装が済んでいるなら doc を削除する。残したい WHY は参照元のコードコメントへ移すか、',
    '複数箇所が依存する設計判断なら docs/design/ へ昇格させる。',
    '進行中なら frontmatter に `review-by` と `review-reason` を書いて見直し期限を宣言する。',
    '長期保持する WHY 集約 doc なら frontmatter に `lifecycle: durable` を書く。',
  ],
  'grace-expired': [
    '宣言した期限が来ている。doc を削除するか、内容を実装に合わせて更新する。',
    '期限だけ延ばす場合は `review-reason` も現状に合わせて書き直す。',
  ],
  'invalid-frontmatter': ['frontmatter の lifecycle 宣言を修正する。'],
  'broken-link': [
    'リンク先の移動先に張り替えるか、参照ごと削除する。',
    'doc を消したあとの残骸ならこの記述自体が不要になっていることが多い。',
  ],
  'dangling-reference': [
    '削除済み doc を指している参照を、退避先（コードコメント / docs/design/）へ張り替える。',
  ],
};

const VIOLATION_ORDER: readonly Violation['kind'][] = [
  'invalid-frontmatter',
  'grace-expired',
  'stale',
  'broken-link',
  'dangling-reference',
];

export function formatReport(result: AnalyzeResult): string {
  const { violations } = result;
  if (violations.length === 0) {
    return `✅ docs のライフサイクル違反はありません（${result.statuses.length} 件を検査）。`;
  }

  const lines = [`❌ docs のライフサイクル違反が ${violations.length} 件あります:`, ''];

  for (const kind of VIOLATION_ORDER) {
    const group = violations.filter((violation) => violation.kind === kind);
    if (group.length === 0) continue;

    for (const violation of group) {
      lines.push(`  ${formatViolation(violation).split('\n').join('\n  ')}`);
    }
    lines.push('');
    lines.push(...REMEDIES[kind].map((remedy) => `  → ${remedy}`));
    lines.push('');
  }

  lines.push('判断基準は .claude/rules/doc-placement.md を参照してください。');
  return lines.join('\n');
}

/** 棚卸し作業用の一覧。違反していない doc も鮮度付きで出す */
export function formatStatusList(statuses: readonly DocStatus[]): string {
  const rows = [...statuses].sort((a, b) => a.path.localeCompare(b.path));

  return rows
    .map((status) => {
      const verdict = status.verdict;
      const age =
        verdict.kind === 'fresh' || verdict.kind === 'stale'
          ? `${verdict.ageDays}日`
          : verdict.kind === 'in-grace' || verdict.kind === 'grace-expired'
            ? `${verdict.ageDays ?? '-'}日`
            : '-';
      return `${verdict.kind.padEnd(14)} ${status.lifecycle.padEnd(10)} ${age.padEnd(7)} ${
        status.referencedBy.length
      } refs  ${status.path}`;
    })
    .join('\n');
}
