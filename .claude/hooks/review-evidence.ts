import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// hook-utils.ts は `bun` を読み込むので、Node のテストランナーからも読み込めるよう同じ判定をここに持つ。
// review-count.ts も同じ理由で、ファイルを読み書きする関数の中で遅れて読み込む。
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Local, self-declared review evidence; this is not reviewer authentication. */
export interface ReviewEvidence {
  schemaVersion: 1;
  headSha: string;
  baseRef: string;
  baseSha: string;
  reviewer: string;
  reportText: string;
  reportSha256: string;
  roundsSha256: string;
}
const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
export function createReviewEvidence(input: {
  headSha: string;
  baseRef: string;
  baseSha: string;
  reviewer: string;
  reportText: string;
  roundsText: string;
}): ReviewEvidence {
  if (!input.reportText.trim()) throw new Error('Review evidence report must not be blank.');
  if (!input.baseRef.trim() || !input.reviewer.trim())
    throw new Error('Review base and reviewer are required.');
  if (![input.headSha, input.baseSha].every((sha) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha))) {
    throw new Error('Review evidence requires resolved commit SHAs.');
  }
  return {
    schemaVersion: 1,
    headSha: input.headSha,
    baseRef: input.baseRef,
    baseSha: input.baseSha,
    reviewer: input.reviewer,
    reportText: input.reportText,
    reportSha256: digest(input.reportText),
    roundsSha256: digest(input.roundsText),
  };
}

export function checkReviewEvidence(
  value: unknown,
  expected: { headSha: string; baseSha: string; roundsText: string },
): string | null {
  if (!value || typeof value !== 'object') return 'Review evidence is missing.';
  if (!isRecord(value)) return 'Review evidence must be an object.';
  const evidence = value;
  if (evidence.schemaVersion !== 1) return 'Unsupported review evidence schema.';
  if (evidence.headSha !== expected.headSha) return 'Review evidence HEAD is stale.';
  if (evidence.baseSha !== expected.baseSha) return 'Review evidence base is stale.';
  if (
    typeof evidence.baseRef !== 'string' ||
    !evidence.baseRef.trim() ||
    typeof evidence.reviewer !== 'string' ||
    !evidence.reviewer.trim()
  )
    return 'Review evidence metadata is missing.';
  if (evidence.roundsSha256 !== digest(expected.roundsText))
    return 'Review rounds changed after evidence was recorded.';
  if (typeof evidence.reportText !== 'string' || !evidence.reportText.trim())
    return 'Review evidence report is blank.';
  if (evidence.reportSha256 !== digest(evidence.reportText))
    return 'Review evidence report hash does not match.';
  return null;
}
export async function readReviewEvidence(input?: { cwd?: string }): Promise<unknown> {
  const { reviewCountFile } = await import('./review-count.ts');
  try {
    return JSON.parse(await readFile(`${await reviewCountFile(input)}.evidence.json`, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}
export async function writeReviewEvidence(
  evidence: ReviewEvidence,
  input?: { cwd?: string },
): Promise<void> {
  const { reviewCountFile } = await import('./review-count.ts');
  await writeFile(
    `${await reviewCountFile(input)}.evidence.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
}

export function parseRoundArgs(args: string[]): {
  flags: string[];
  baseRef?: string;
  evidencePath?: string;
} {
  const flags: string[] = [];
  let baseRef: string | undefined;
  let evidencePath: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--base' || arg === '--evidence') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      if (arg === '--base') {
        if (baseRef !== undefined) throw new Error('Duplicate --base.');
        baseRef = value;
      } else {
        if (evidencePath !== undefined) throw new Error('Duplicate --evidence.');
        evidencePath = value;
      }
    } else flags.push(arg);
  }
  if ((baseRef === undefined) !== (evidencePath === undefined))
    throw new Error('--base and --evidence must be supplied together.');
  return { flags, baseRef, evidencePath };
}
