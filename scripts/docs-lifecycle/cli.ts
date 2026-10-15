/**
 * docs のライフサイクル lint CLI（`mise run lint-docs`）。
 *
 * 実装と乖離した設計 doc が残り続けるのを防ぐため、「触られていない期間」を
 * 機械的な指標にして見直しを強制する。判定ロジックは同じ package 内に置く。
 * 運用上の判断基準（消すか / 退避するか / 猶予するか）は .claude/rules/doc-placement.md。
 *
 * オプション:
 *   --list  違反していない doc も含めて鮮度一覧を出す（棚卸し作業用）
 *   --json  機械可読な出力（他ツール連携用）
 *
 * 実行に要るものは ziku で配る package 内に収めてある:
 *   1. run.ts から実行する（`mise run lint-docs` がこれを呼ぶ）。bun.lock に従って package 内
 *      だけに依存を同期してから起動するため、同期先リポジトリの package.json / node_modules と
 *      分離できる
 *   2. `.config/docs-lifecycle.json` を置く（無ければ警告を出して何もしない）
 *   3. この lint を回す全ワークフローの checkout に `fetch-depth: 0` を指定する
 *      （shallow clone では鮮度チェックが警告付きでスキップされ、検知が効かない）
 *
 * 届いた設定はそのまま使える形にしてある。リポジトリ固有の事情は設定ではなく doc 側の
 * frontmatter で表す（生成物なら `lifecycle: generated`、進行中なら `review-by`）。
 * 設定にリポジトリ固有のパスを書くと、双方向同期でそれが他リポジトリへ流れ込む。
 */

/// <reference types="node" />

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import { type DocSource, analyze } from './analyze.ts';
import { isScanned, parseConfig } from './config.ts';
import {
  collectLastCommitDates,
  grepDocReferences,
  isShallowRepository,
  listLocallyModifiedFiles,
  listRepoFiles,
} from './git.ts';
import { formatReport, formatStatusList } from './report.ts';

// URL.pathname はパーセントエンコードされたまま（`/tmp/my repo/` → `/tmp/my%20repo/`）なので
// fileURLToPath でデコードする。しないと、空白や非 ASCII を含む場所に置かれた
// チェックアウトで設定ファイルが「無い」と判定され、このチェックが黙って無効になる。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const configPath = join(repoRoot, '.config/docs-lifecycle.json');
const args = new Set(process.argv.slice(2));

if (!existsSync(configPath)) {
  // 設定が無いリポジトリ（ziku で lint 本体だけが配られた直後）を赤にしない。
  // 設定を置くまでチェックは働かないので、導入時は .config/docs-lifecycle.json を作る。
  console.warn(`⚠️  ${configPath} がありません。docs ライフサイクル check をスキップします。`);
  process.exit(0);
}

const config = parseConfig(JSON.parse(readFileSync(configPath, 'utf8')));

// shallow clone では最終コミット日時が実際より新しく見え、stale な doc を fresh と
// 誤判定する。鮮度判定だけを止め、リンク切れ・参照残骸のチェックは続ける
// （履歴に依存しないため）。ここで異常終了させないのは、依存更新のように
// 浅い checkout で集約 lint を回すワークフローを巻き込まないため。
const historyAvailable = !isShallowRepository(repoRoot);
if (!historyAvailable) {
  console.warn(
    [
      '⚠️  shallow clone のため docs の鮮度チェックをスキップします（リンク切れの検査は実行します）。',
      'CI では checkout に fetch-depth: 0 を指定し、ローカルでは git fetch --unshallow してください。',
    ].join('\n'),
  );
}

const docPaths = listRepoFiles(repoRoot).filter((path) => isScanned(path, config));
const lastCommitDates = collectLastCommitDates(docPaths, repoRoot);
const locallyModified = listLocallyModifiedFiles(repoRoot);

const docs: DocSource[] = docPaths.map((path) => ({
  path,
  content: readFileSync(join(repoRoot, path), 'utf8'),
  lastCommittedAt: locallyModified.has(path) ? null : (lastCommitDates.get(path) ?? null),
}));

const existsCache = new Map<string, boolean>();
const pathExists = (relativePath: string): boolean => {
  const cached = existsCache.get(relativePath);
  if (cached !== undefined) return cached;
  const exists = existsSync(join(repoRoot, relativePath));
  existsCache.set(relativePath, exists);
  return exists;
};

const result = analyze({
  config,
  docs,
  references: grepDocReferences(config.referencePrefixes, repoRoot),
  pathExists,
  now: DateTime.utc(),
  historyAvailable,
});

if (args.has('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (args.has('--list')) {
    console.log(formatStatusList(result.statuses));
    console.log('');
  }
  const report = formatReport(result);
  if (result.violations.length === 0) {
    console.log(report);
  } else {
    console.error(report);
  }
}

process.exit(result.violations.length === 0 ? 0 : 1);
