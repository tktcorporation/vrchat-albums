#!/usr/bin/env bun
/** Explicit gate for hosts that do not dispatch repository PreToolUse hooks. */
import { $ } from 'bun';
import { isRecord } from './hook-utils.ts';
import { requireReviewedPr, remoteHeadSha } from './require-pr-self-review-mcp.ts';
import { reviewCountFile } from './review-count.ts';
import { checkReviewEvidence, readReviewEvidence } from './review-evidence.ts';

type CreateRequest = {
  repository_full_name: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: true;
};

const REQUEST_KEYS = ['repository_full_name', 'head', 'base', 'title', 'body', 'draft'];

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
  const baseRef = `refs/heads/${request.base}`;
  const validRef = await $`git check-ref-format ${baseRef}`.quiet().nothrow();
  if (validRef.exitCode !== 0) throw new Error('Invalid base branch');
  const status = await $`git status --porcelain`.quiet();
  if (status.text().trim()) throw new Error('Commit or remove unreviewed working-tree changes');
  const { headSha, headBranch } = await requireReviewedPr({
    cwd: process.cwd(),
    tool_input: request,
  });
  if (headSha !== expectedHead) throw new Error('Expected head differs from reviewed HEAD');
  const baseSha = await remoteHeadSha(process.cwd(), request.base);
  if (!baseSha || baseSha !== expectedBase)
    throw new Error('Remote base changed or could not be read');
  const roundsText = await Bun.file(await reviewCountFile()).text();
  const evidenceError = checkReviewEvidence(await readReviewEvidence(), {
    headSha,
    baseSha,
    roundsText,
  });
  if (evidenceError) throw new Error(evidenceError);
  // Recheck after reading evidence; a concurrent push still cannot be atomically locked with PR creation.
  if ((await remoteHeadSha(process.cwd(), headBranch)) !== headSha) {
    throw new Error('Remote head changed during preflight');
  }
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      decision: 'allow',
      expectedHead,
      expectedBase,
      headBranch,
      request,
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
