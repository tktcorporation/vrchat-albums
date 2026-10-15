/**
 * docs ライフサイクル lint の中核。git と fs を注入して純関数として判定する。
 *
 * 検知するのは 3 種類:
 *   - 鮮度違反（stale / 宣言した見直し期限の超過）
 *   - doc 内リンクの切れ
 *   - 削除済み doc を指したままの参照（コードコメント・他 doc）
 *
 * WHY: doc が実装と乖離するのは「更新されないまま残る」ことが原因なので、
 * 内容の正しさではなく「触られていない期間」を機械的な代理指標にする。
 */

import { DateTime } from 'luxon';
import {
  type DocsLifecycleConfig,
  type Lifecycle,
  resolveLifecycleByPath,
  staleDaysFor,
} from './config.ts';
import { type DocMeta, parseDocMeta } from './frontmatter.ts';
import { type FreshnessVerdict, judgeFreshness } from './freshness.ts';
import { matchesAnyGlob } from './glob.ts';
import { extractMarkdownLinks, resolveLinkTarget } from './links.ts';
import { type DocReference, buildReferenceIndex } from './references.ts';

export interface DocSource {
  /** リポジトリルート相対パス */
  path: string;
  content: string;
  /** ISO 8601。null は git 履歴に無い、またはローカルで編集中（どちらも鮮度を問わない） */
  lastCommittedAt: string | null;
}

export type Violation =
  | { kind: 'invalid-frontmatter'; path: string; problems: string[] }
  | {
      kind: 'stale';
      path: string;
      lifecycle: Lifecycle;
      ageDays: number;
      limitDays: number;
      referencedBy: readonly DocReference[];
    }
  | {
      kind: 'grace-expired';
      path: string;
      until: string;
      referencedBy: readonly DocReference[];
    }
  | { kind: 'broken-link'; path: string; line: number; target: string }
  | { kind: 'dangling-reference'; fromPath: string; line: number; target: string };

export interface DocStatus {
  path: string;
  lifecycle: Lifecycle;
  verdict: FreshnessVerdict;
  referencedBy: readonly DocReference[];
}

export interface AnalyzeInput {
  config: DocsLifecycleConfig;
  /** scan 対象に絞り込み済みの doc */
  docs: readonly DocSource[];
  /** リポジトリ全文検索で拾った doc パス参照 */
  references: readonly DocReference[];
  /** リポジトリルート相対パスが実在するかの判定 */
  pathExists: (path: string) => boolean;
  now: DateTime;
  /** false（shallow clone）なら鮮度判定を止め、リンク・参照チェックだけ実行する */
  historyAvailable: boolean;
}

export interface AnalyzeResult {
  statuses: DocStatus[];
  violations: Violation[];
}

const EMPTY_META: DocMeta = { lifecycle: null, reviewBy: null, reviewReason: null };

function referenceKey(reference: DocReference): string {
  return `${reference.fromPath}:${reference.line}:${reference.target}`;
}

function dedupeReferences(references: readonly DocReference[]): DocReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = referenceKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** doc 内の相対リンクを検証し、リンク切れと「doc → doc の参照」を同時に取り出す */
function analyzeLinks(
  doc: DocSource,
  pathExists: (path: string) => boolean,
): { violations: Violation[]; references: DocReference[] } {
  const violations: Violation[] = [];
  const references: DocReference[] = [];

  for (const link of extractMarkdownLinks(doc.content)) {
    const resolved = resolveLinkTarget(doc.path, link.target);
    if (resolved.kind === 'not-checkable') continue;

    // リポジトリ外へ出るリンクは、辿れる先がリポジトリに無いという意味で
    // リンク切れと同じ。存在チェックには回さない（実行環境のファイルを見てしまう）。
    if (resolved.kind === 'outside-repo' || !pathExists(resolved.path)) {
      violations.push({
        kind: 'broken-link',
        path: doc.path,
        line: link.line,
        target: link.target,
      });
      continue;
    }
    references.push({ fromPath: doc.path, line: link.line, target: resolved.path });
  }

  return { violations, references };
}

export function analyze(input: AnalyzeInput): AnalyzeResult {
  const { config, docs, pathExists, now } = input;
  const violations: Violation[] = [];
  const statuses: DocStatus[] = [];
  const collectedReferences: DocReference[] = [...input.references];

  const metaByPath = new Map<string, DocMeta>();

  for (const doc of docs) {
    const parsed = parseDocMeta(doc.content);
    if (parsed.kind === 'invalid') {
      violations.push({ kind: 'invalid-frontmatter', path: doc.path, problems: parsed.problems });
      metaByPath.set(doc.path, EMPTY_META);
    } else {
      metaByPath.set(doc.path, parsed.meta);
    }

    const links = analyzeLinks(doc, pathExists);
    violations.push(...links.violations);
    collectedReferences.push(...links.references);
  }

  const activeReferences = dedupeReferences(collectedReferences).filter(
    (reference) => !matchesAnyGlob(reference.fromPath, config.referenceIgnoreFrom),
  );

  for (const reference of activeReferences) {
    if (!config.referencePrefixes.some((prefix) => reference.target.startsWith(prefix))) continue;
    if (pathExists(reference.target)) continue;
    violations.push({
      kind: 'dangling-reference',
      fromPath: reference.fromPath,
      line: reference.line,
      target: reference.target,
    });
  }

  const referenceIndex = buildReferenceIndex(activeReferences);

  for (const doc of docs) {
    const meta = metaByPath.get(doc.path) ?? EMPTY_META;
    const lifecycle = meta.lifecycle ?? resolveLifecycleByPath(doc.path, config);

    // generated は経過日数を見ないので、猶予期限を書いても効かない。黙って無視すると
    // 「期限を宣言したのに報告されない」状態になるため、宣言自体を違反として弾く。
    if (lifecycle === 'generated' && meta.reviewBy !== null) {
      violations.push({
        kind: 'invalid-frontmatter',
        path: doc.path,
        problems: [
          '`generated` な doc に `review-by` は書けません（生成物の鮮度は生成チェックが担保します）',
        ],
      });
    }
    // 経過日数を日境界で数えるため、コミット日時と now を同じ UTC に揃える
    // （呼び出し側は now も UTC で渡す）
    const lastCommitted =
      doc.lastCommittedAt === null ? null : DateTime.fromISO(doc.lastCommittedAt, { zone: 'utc' });
    const verdict = judgeFreshness({
      lifecycle,
      lastCommittedAt: lastCommitted?.isValid === true ? lastCommitted : null,
      meta,
      limitDays: staleDaysFor(lifecycle, config),
      now,
      historyAvailable: input.historyAvailable,
    });

    // 自己参照は棚卸しの判断材料にならないので除く
    const referencedBy = (referenceIndex.get(doc.path) ?? []).filter(
      (reference) => reference.fromPath !== doc.path,
    );

    statuses.push({ path: doc.path, lifecycle, verdict, referencedBy });

    if (verdict.kind === 'stale') {
      violations.push({
        kind: 'stale',
        path: doc.path,
        lifecycle,
        ageDays: verdict.ageDays,
        limitDays: verdict.limitDays,
        referencedBy,
      });
    }
    if (verdict.kind === 'grace-expired') {
      violations.push({
        kind: 'grace-expired',
        path: doc.path,
        until: verdict.until,
        referencedBy,
      });
    }
  }

  return { statuses, violations };
}
