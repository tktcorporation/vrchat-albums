/**
 * クラウドの push ラッパー（.codex/cloud-pr-feedback.cjs の push モード）が、GitHub コネクタで
 * 取り直した指摘に対してゲートを通した結果を、続く `git push` の PreToolUse hook へ渡す許可。
 *
 * `gh` が認証できない環境では、require-pr-feedback-review.ts が指摘を取得できず push を止める。
 * 同じ判定はコネクタ経由で直前に済んでいるため、その結果をブランチと HEAD に紐づけた短命の
 * 記録として残し、`gh` が使えないときに限って 1 回だけ使わせる。記録は自己申告で、
 * レビュー記録（.rounds）と同じくエージェント自身が書き換えられる。
 */
import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isRecord } from './hook-utils.ts';
import { nowMs } from './iso-time.ts';
import { externalReviewFile } from './review-count.ts';

/** ラッパーはゲート通過から push までを連続して実行する。それより長く残る許可は使わせない。 */
export const CLOUD_PUSH_GRANT_TTL_MS = 120_000;

type PushTarget = { branch: string; head: string };

async function grantFile(input?: { cwd?: string } | null): Promise<string> {
  return `${await externalReviewFile(input)}.cloud-push.json`;
}

export async function writeCloudPushGrant(
  input: { cwd?: string } | null,
  target: PushTarget,
): Promise<void> {
  const expiresAt = nowMs() + CLOUD_PUSH_GRANT_TTL_MS;
  const path = await grantFile(input);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify({ ...target, expiresAt }));
}

/** 記録が今回の push（ブランチと HEAD）に対する期限内の許可かを判定する。null なら許可する。 */
export function checkCloudPushGrant(
  text: string,
  target: PushTarget & { now: number },
): string | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return 'クラウドの push 許可を読み取れません';
  }
  if (!isRecord(value)) return 'クラウドの push 許可を読み取れません';
  const { branch, head, expiresAt } = value;
  if (typeof branch !== 'string' || typeof head !== 'string' || typeof expiresAt !== 'number')
    return 'クラウドの push 許可を読み取れません';
  if (branch !== target.branch || head !== target.head)
    return 'クラウドの push 許可が現在のブランチと HEAD に一致しません';
  if (target.now > expiresAt) return 'クラウドの push 許可の期限が切れています';
  return null;
}

/** 許可を 1 回だけ使う。判定の成否にかかわらず記録は消し、同じ記録で 2 回 push させない。 */
export async function consumeCloudPushGrant(
  input: { cwd?: string } | null,
  target: PushTarget,
): Promise<string | null> {
  const path = await grantFile(input);
  const file = Bun.file(path);
  if (!(await file.exists())) return 'クラウドの push 許可がありません';
  const text = await file.text();
  await rm(path, { force: true });
  return checkCloudPushGrant(text, { ...target, now: nowMs() });
}
