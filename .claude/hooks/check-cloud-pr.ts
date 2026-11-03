#!/usr/bin/env bun
/**
 * Explicit gate for hosts that do not dispatch repository PreToolUse hooks. It allows the exact
 * request only when the shared gate (pr-review-gate.ts checkPrTarget) accepts the remote head and the
 * PR base, and the self-declared review evidence still matches the head, the default branch tip the
 * review covered, and the rounds.
 */
import { $ } from 'bun';
import { createHash } from 'node:crypto';
import { matchesGitHubRemote } from './cloud-pr-feedback.ts';
import { currentBranch, isRecord } from './hook-utils.ts';
import { prCreateTarget } from './pr-create-target.ts';
import { checkPrTarget, readRemoteHeads } from './pr-review-gate.ts';
import { readRecordedEntries } from './review-count.ts';
import { checkReviewEvidence, readReviewEvidence } from './review-evidence.ts';
import { formatEntries } from './review-policy.ts';

type CreateRequest = {
  repository_full_name: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: true;
};

// .codex/create-reviewed-pr.cjs の REQUEST_KEYS と同じ並び。両側がこの順のキーで直列化した要求を
// ハッシュして突き合わせる。
const REQUEST_KEYS = ['repository_full_name', 'head', 'base', 'title', 'body', 'draft'];

/**
 * 許可した要求の SHA-256。要求をそのまま返すと、長い本文で出力が上限を超えて切れ、ラッパーが
 * JSON を読めなくなるため、ラッパーが送る要求と同じかどうかはこのハッシュで照合させる。
 */
const requestDigest = (request: CreateRequest): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.fromEntries(REQUEST_KEYS.map((key) => [key, Reflect.get(request, key)])),
      ),
    )
    .digest('hex');

const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const isSha = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

// hook は同期先のどのリポジトリでも依存なしで動く必要があるため、スキーマライブラリを使わずに検査する。
// 想定外のキーを拒否するのは、検査していない項目がコネクタへそのまま渡るのを防ぐため。
function parsePayload(value: unknown): {
  request: CreateRequest;
  expectedHead: string;
  expectedBase: string;
} {
  if (!isRecord(value) || !hasOnlyKeys(value, ['request', 'expectedHead', 'expectedBase']))
    throw new Error('Invalid PR creation payload');
  const { request, expectedHead, expectedBase } = value;
  if (!isSha(expectedHead) || !isSha(expectedBase)) throw new Error('Invalid expected SHA');
  if (!isRecord(request) || !hasOnlyKeys(request, REQUEST_KEYS))
    throw new Error('Invalid PR creation request');
  const { repository_full_name, head, base, title, body, draft } = request;
  if (
    !isText(repository_full_name) ||
    !isText(head) ||
    !isText(base) ||
    !isText(title) ||
    typeof body !== 'string' ||
    !body ||
    draft !== true
  )
    throw new Error('Invalid PR creation request');
  return {
    request: {
      repository_full_name: repository_full_name.trim(),
      head: head.trim(),
      base: base.trim(),
      title: title.trim(),
      body,
      draft,
    },
    expectedHead,
    expectedBase,
  };
}

try {
  const { request, expectedHead, expectedBase } = parsePayload(JSON.parse(await Bun.stdin.text()));
  const cwd = process.cwd();
  const baseRef = `refs/heads/${request.base}`;
  const validRef = await $`git check-ref-format ${baseRef}`.quiet().nothrow();
  if (validRef.exitCode !== 0) throw new Error('Invalid base branch');
  const status = await $`git status --porcelain`.quiet();
  if (status.text().trim()) throw new Error('Commit or remove unreviewed working-tree changes');
  const target = prCreateTarget(request);
  if (target.headOwner.toLowerCase() !== target.owner.toLowerCase())
    throw new Error('Cross-owner fork PRs cannot be created through this wrapper');
  const headBranch = target.headBranch;
  // The review evidence sidecar belongs to the rounds file of the checked-out branch.
  if ((await currentBranch(cwd)) !== headBranch)
    throw new Error(`Run from a checkout of the head branch ${headBranch}`);
  const repo = `${target.owner}/${target.repo}`.toLowerCase();
  // コネクタは github.com に PR を作るので、証跡と head・base を読む origin も github.com の同じ
  // リポジトリでなければならない。別ホストの同名リポジトリの証跡で github.com の PR を通さない。
  const originUrls = (await $`git config --get-all remote.origin.url`.quiet().nothrow())
    .text()
    .split('\n')
    .filter((line) => line.trim() !== '');
  if (originUrls.length !== 1 || !matchesGitHubRemote(originUrls[0] ?? '', repo))
    throw new Error('origin is not the GitHub.com repository the connector creates the PR in');
  // Convergence (attestation of the remote head SHA) and the base rule are decided by the shared gate
  // (pr-review-gate.ts) from one read of origin's branches; the SHAs below come from that same read.
  const verdict = await checkPrTarget(repo, headBranch, cwd, [request.base]);
  if (verdict.kind === 'denied') throw new Error(verdict.reason);
  if (verdict.headSha !== expectedHead) throw new Error('Remote head differs from expected head');
  const baseSha = verdict.baseShas.get(request.base);
  if (!baseSha || baseSha !== expectedBase)
    throw new Error('Remote base changed or could not be read');
  // The attestation covers <default-branch>...HEAD, so the final review evidence is bound to the default
  // branch tip even when the PR targets a stacked base.
  const reviewedBaseSha = verdict.defaultSha;
  if (!reviewedBaseSha) throw new Error('Remote default branch could not be read');
  const evidenceError = checkReviewEvidence(await readReviewEvidence({ cwd }), {
    headSha: expectedHead,
    baseSha: reviewedBaseSha,
    roundsText: formatEntries(await readRecordedEntries({ cwd })),
  });
  if (evidenceError) throw new Error(evidenceError);
  // Recheck after reading evidence; a concurrent push still cannot be atomically locked with PR creation.
  const recheck = await readRemoteHeads(cwd);
  if (
    recheck.kind !== 'ok' ||
    recheck.heads.get(headBranch) !== expectedHead ||
    recheck.heads.get(request.base) !== baseSha ||
    (verdict.defaultBranch !== null && recheck.heads.get(verdict.defaultBranch) !== reviewedBaseSha)
  ) {
    throw new Error('Remote head or base changed during the check');
  }
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      decision: 'allow',
      expectedHead,
      expectedBase,
      headBranch,
      requestDigest: requestDigest(request),
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      decision: 'deny',
      reason: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
}
