#!/usr/bin/env bun
/**
 * PreToolUse / PostToolUse(Write|Edit): エージェント自身が書いたファイルと、書いた直後の内容の
 * ハッシュをセッション単位で記録する。
 *
 * 作業ツリーの差分には、エージェントが書いたものと、ユーザーや別プロセスが書いたものが混ざる。
 * `git restore` などで巻き戻してよいのは前者だけなので、前者を確定できる唯一の情報源
 * （このセッションの Write / Edit ツール呼び出し）をここで残す。
 *
 * - 編集前（PreToolUse）: そのファイルに未コミットの差分が無ければ「自分が書く候補」として記録する。
 *   既に差分があるファイルは他人の変更を含みうるので記録しない。自分のものだったファイルでも、
 *   記録したハッシュと今の内容が違えば誰かが変えているので所有を手放す（`foreign`）
 * - 編集後（PostToolUse）: 候補または既に自分のものであるファイルについて、内容のハッシュを記録する。
 *   判定側（pre-bash-guard.ts）は現在の内容がこのハッシュと一致するときだけ「自分の変更」と見なす。
 *   後からユーザーが同じファイルを変えればハッシュが合わなくなり、他人の変更として守られる
 *
 * 記録は追記のみで、同じパスの行は後の行が優先する。
 */
import { $ } from 'bun';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { editedFilesPath, ownershipFingerprint, readEditedFiles, readInput } from './hook-utils.ts';

const input = await readInput();
const supplied = input?.tool_input?.file_path ?? input?.tool_input?.path;
if (!supplied) process.exit(0);
const recordPath = await editedFilesPath(input?.session_id);
if (!recordPath) process.exit(0);
const path: string = recordPath;
const absolute = resolve(input?.cwd ?? process.cwd(), supplied);
const owned = await readEditedFiles(input?.session_id);

async function record(hash: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true }).catch(() => undefined);
  await appendFile(path, `${absolute}\t${hash}\n`).catch(() => undefined);
}

const recorded = owned.get(absolute);

if (input?.hook_event_name === 'PostToolUse') {
  // 候補か自分のものだったファイルだけ、書いた後の内容を自分のものとして記録する
  if (!recorded || recorded === 'foreign') process.exit(0);
  // ファイルを消す編集（apply_patch の Delete File など）は `deleted` として自分のものに残す
  const hash = (await ownershipFingerprint(absolute)) ?? 'deleted';
  await record(hash);
  process.exit(0);
}

// PreToolUse
if (recorded && recorded !== 'pending' && recorded !== 'foreign') {
  // 自分が最後に書いた内容のままなら所有を続ける。誰かが変えていれば、その変更を含むので手放す
  if (recorded === ((await ownershipFingerprint(absolute)) ?? 'deleted')) process.exit(0);
  await record('foreign');
  process.exit(0);
}
// 差分があるファイルは他人の変更を含みうるので候補にしない
const status = await $`git -C ${dirname(absolute)} status --porcelain -z -- ${absolute}`
  .quiet()
  .nothrow();
if (status.exitCode === 0 && status.text().trim() !== '') {
  if (recorded !== 'foreign') await record('foreign');
  process.exit(0);
}
await record('pending');
