#!/usr/bin/env bun
/**
 * PreToolUse(mcp__*__[github_]create_pull_request、
 *   Cursor では MCP:[github_]create_pull_request): GitHub MCP 経由の PR 作成にも、Bash の
 * `gh pr create` と同じ証跡のゲート（pr-review-gate.ts の checkAttestation）を掛ける。
 *
 * ツール入力にディレクトリの手がかりは無いので、リモートを引く場所には、台帳で同じ
 * owner/repo と head ブランチの収束を記録したチェックアウトのうち、いまも残っていて記録どおりの
 * origin（repo とホスト）を持つ最新のものを使う。origin にホストの無い記録は候補にしない。
 * 候補のホストが PR の対象ホストを決めるので、候補が複数のホストにまたがれば止める。
 *
 * head の "owner:branch" 形式は owner 部分がベースリポジトリの owner と一致する場合だけ
 * 受け付ける（owner 部分を無視すると、無関係な "<他人>:<一致するブランチ名>" が同じ
 * owner/repo に見えてすり抜ける）。owner の異なるフォーク間 PR は `gh pr create` で作成する。
 *
 * 対象外: 一度 close した PR を state: "open" で reopen する経路
 * （mcp__github__update_pull_request）は新規 PR 作成に当たらないため塞いでいない。
 * `gh api -X POST .../pulls` のような、gh の pr サブコマンドを経由しない生の API 呼び出しも対象外。
 */
import { existsSync } from 'node:fs';
import { originRepository } from './hook-utils.ts';
import { prCreateTarget } from './pr-create-target.ts';
import {
  baseDenyReason,
  checkAttestation,
  denyJson,
  readAttestations,
  type Attestation,
} from './pr-review-gate.ts';

const PREFIX = 'PR作成をブロックしました（GitHub MCP 経由）。';

/** 通してよければ null、止めるなら理由を返す。 */
export async function reviewDenyReason(toolInput: unknown): Promise<string | null> {
  const target = prCreateTarget(toolInput);
  const { owner, repo, head, headOwner, headBranch } = target;
  if (headOwner.toLowerCase() !== owner.toLowerCase()) {
    return `head（${head}）はベースリポジトリ（${owner}/${repo}）と owner の異なるフォーク間 PR です。この経路では作成できないので、gh pr create（Bash）で作成してください。`;
  }
  const name = `${owner}/${repo}`.toLowerCase();
  const recordedForBranch = (await readAttestations()).filter(
    (entry) => entry.repo === name && entry.branch === headBranch,
  );
  // 台帳は追記だけなので、消えたチェックアウトや、記録後に origin を書き換えたチェックアウトの
  // 記録も残る。いまも記録どおりの origin を持つものだけを候補にする。
  const candidates: Attestation[] = [];
  for (const entry of recordedForBranch) {
    // ホストの無い origin（ローカルのパスや file://）の記録は、MCP サーバーが PR を作る
    // GitHub 上のホストと結びつかないので候補にしない（Bash の経路も同じく止める）。
    if (entry.host === null || !existsSync(entry.checkout)) continue;
    const origin = await originRepository(entry.checkout);
    if (
      origin &&
      `${origin.owner}/${origin.repo}`.toLowerCase() === entry.repo &&
      origin.host === entry.host
    )
      candidates.push(entry);
  }
  // MCP の入力にはホストが無いので、同名のリポジトリとブランチの記録が複数のホストにあれば、
  // どのホストに PR が作られるかを決められない。
  const hosts = new Set(candidates.map((entry) => entry.host));
  if (hosts.size > 1)
    return `${name} の ${headBranch} ブランチの収束記録が複数のホスト（${[...hosts].join(', ')}）にあり、PR を作るホストを決められません。Bash の gh pr create -R <host/owner/repo> --head ${headBranch} で作成してください。`;
  const recorded = candidates.at(-1);
  if (!recorded) {
    return `${name} の ${headBranch} ブランチで収束を記録し、いまも同じ origin を持つチェックアウトが見つかりません。このブランチをチェックアウトしたディレクトリで .claude/skills/pr-review-loop/SKILL.md の手順を回して収束を記録し、push してから再実行してください。`;
  }
  const baseReason = await baseDenyReason(recorded.checkout, target.base);
  if (baseReason) return baseReason;
  return checkAttestation(name, headBranch, recorded.checkout);
}

if (import.meta.main) {
  let reason: string | null;
  try {
    reason = await reviewDenyReason(JSON.parse(await Bun.stdin.text())?.tool_input);
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  if (reason) console.log(denyJson(`${PREFIX}${reason}`));
  // タイムアウトで kill した子の孫など、残った処理を待たずに判定を返して終える。
  process.exit(0);
}
