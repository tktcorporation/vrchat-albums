#!/usr/bin/env bun
/**
 * PreToolUse(Bash): 他人の作業を巻き込むコマンドと、作法に反するコマンドを実行前に止める。
 *
 * 主防御は Claude Code の Automode とプロジェクトルールで、この hook はセキュリティ境界でも
 * 完全な shell 解釈器でもない。通常の操作の範囲で、他者の未コミット変更や PR 作成手順など
 * Automode だけでは確認しにくい不可逆操作に遭遇したときだけ、実行前にガードレールを見せる
 * 補助に留める。フラグの束ね方や pathspec の全パターンまでは追わず、迂回しようと思えば
 * 迂回できる作りを許容する。狙いは、通ろうとしたときにガードレールの存在に気づかせること。
 *
 * 判定は command-parse.ts が認識する通常の直接コマンドに対して行う。文書 heredoc、引用された
 * 説明、外部スクリプトやラッパーの中身は対象にしない。
 *
 * git の巻き戻し（restore / checkout / stash）は、対象がこのセッションのエージェント自身が
 * Write / Edit で書いた変更なら通し、それ以外の未コミット変更に及ぶなら止める。
 * 「自分の変更」は、編集前にそのファイルが clean で、かつ今の内容が自分が最後に書いたときの
 * ままであるものに限る（track-edits.ts が記録）。
 * 自分が書いていない差分はユーザーか別プロセスの作業なので、消す判断はエージェントがしない。
 */
import { Glob } from 'bun';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  gitTarget,
  parseCommands,
  wordValue,
  type ShellWord,
  type SimpleCommand,
} from './command-parse.ts';
import { dirtyFiles } from './foreign-changes.ts';
import {
  isPrCreateCommand,
  ownershipFingerprint,
  projectDirectory,
  readEditedFiles,
} from './hook-utils.ts';

const text = await Bun.stdin.text();
let input: { session_id?: string; cwd?: string; tool_input?: { command?: string } };
try {
  input = JSON.parse(text);
} catch {
  process.exit(0);
}
const command = input?.tool_input?.command ?? '';
// 関数宣言にしているのは、never を返すことを呼び出し側の型の絞り込みに効かせるため
function block(message: string): never {
  console.error(`BLOCKED: ${message}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 1. git の巻き戻し操作を解析する
// ---------------------------------------------------------------------------

type Revert =
  | { kind: 'whole-tree'; why: string }
  | { kind: 'paths'; paths: string[]; base: string }
  | { kind: 'all-dirty'; base: string; why: string }
  | null;

const WHOLE_TREE_TARGET = /^(?:\.|:\/|\*|\.\/\*?)$/;
/** glob や pathspec magic を含む対象。展開先を追わず、作業ツリー全体への操作として扱う。 */
const PATHSPEC_PATTERN = /[*?[\]]|^:/;

/** `git` の単純コマンドから、作業ツリーの変更を消しうる操作を取り出す。 */
export function analyzeGit(command: SimpleCommand): Revert {
  const { directory, subcommand: subcommandWord, args } = gitTarget(command);
  const subcommand = wordValue(subcommandWord);
  if (subcommand === undefined) return null;
  // 対象ディレクトリが実行時にしか決まらない。読み取り専用のサブコマンドまで広く止める必要は
  // ないので、巻き戻し系のサブコマンドに限って保守的に止める
  if (directory.kind === 'unknown' && REVERT_SUBCOMMANDS.has(subcommand))
    return {
      kind: 'whole-tree',
      why: `git ${subcommand}（-C / --work-tree / GIT_WORK_TREE の対象が実行時にしか決まらない）`,
    };
  if (directory.kind === 'unknown') return null;
  const base = directory.path;
  const dashdash = args.findIndex((word) => wordValue(word) === '--');
  const before = dashdash === -1 ? args : args.slice(0, dashdash);
  const after = dashdash === -1 ? [] : args.slice(dashdash + 1);

  // 対象をファイルから読む形は、展開先を追わず作業ツリー全体への操作として扱う
  if (
    ['restore', 'checkout', 'stash'].includes(subcommand) &&
    before.some((word) => {
      const value = wordValue(word);
      return value?.startsWith('--pathspec-from-file') || value === '--pathspec-file-nul';
    })
  )
    return { kind: 'all-dirty', base, why: `git ${subcommand} --pathspec-from-file` };

  switch (subcommand) {
    case 'reset':
      if (before.some((word) => wordValue(word) === '--soft')) return null;
      if (before.some((word) => ['--hard', '--merge', '--keep'].includes(wordValue(word) ?? '')))
        return { kind: 'whole-tree', why: 'git reset（作業ツリー更新モード）' };
      {
        const positional = positionalOf(before, []);
        // With `--`, everything after it is a path. Without it, an existing/tracked first operand
        // is the common path form; otherwise Git treats it as a revision and any remainder as paths.
        const first = wordValue(positional[0]);
        const firstIsPath =
          first !== undefined && (existsSync(resolve(base, first)) || isTracked(base, first));
        const targets = dashdash !== -1 ? after : firstIsPath ? positional : positional.slice(1);
        return targets.length === 0
          ? { kind: 'all-dirty', base, why: 'git reset（対象指定なし）' }
          : classifyTargets(targets, base, 'git reset');
      }
    case 'clean':
      return before.some((word) => {
        const value = wordValue(word);
        return value === '--force' || Boolean(value?.startsWith('-') && value.includes('f'));
      })
        ? { kind: 'whole-tree', why: 'git clean -f' }
        : null;
    case 'restore': {
      const positional = [...positionalOf(before, ['-s', '--source']), ...after];
      return classifyTargets(positional, base, 'git restore');
    }
    case 'switch':
      // ブランチ切り替えで作業ツリーの変更を捨てる指定
      return before.some((word) => {
        const value = wordValue(word);
        return (
          value === '--force' ||
          value === '--discard-changes' ||
          Boolean(value?.startsWith('-') && value.includes('f'))
        );
      })
        ? { kind: 'whole-tree', why: 'git switch --discard-changes' }
        : null;
    case 'checkout': {
      if (
        before.some((word) => {
          const value = wordValue(word);
          return value === '--force' || Boolean(value?.startsWith('-') && value.includes('f'));
        })
      )
        return { kind: 'whole-tree', why: 'git checkout --force' };
      if (
        before.some((word) => ['-b', '-B', '--orphan', '--detach'].includes(wordValue(word) ?? ''))
      )
        return null;
      if (dashdash !== -1) return classifyTargets(after, base, 'git checkout');
      // `--` が無いときはブランチ名かパスか曖昧。作業ツリーに実在するものはパスとして扱う
      const positional = positionalOf(before, ['-t', '--track', '-B', '-b']);
      // 作業ツリーから消されている追跡済みファイル（ユーザーが削除した）も対象になりうる
      const candidates = positional.filter((word) => {
        const value = wordValue(word);
        return (
          value === undefined ||
          WHOLE_TREE_TARGET.test(value) ||
          PATHSPEC_PATTERN.test(value) ||
          existsSync(resolve(base, value)) ||
          isTracked(base, value)
        );
      });
      return candidates.length === 0 ? null : classifyTargets(candidates, base, 'git checkout');
    }
    case 'checkout-index': {
      // -f 無しは既存ファイルを上書きしない（存在しないファイルだけ復元する）ので無害
      if (
        !before.some((word) => {
          const value = wordValue(word);
          return value === '--force' || Boolean(value?.startsWith('-') && value.includes('f'));
        })
      )
        return null;
      if (
        before.some((word) => {
          const value = wordValue(word);
          return value === '--all' || Boolean(value?.startsWith('-') && value.includes('a'));
        })
      )
        return { kind: 'all-dirty', base, why: 'git checkout-index -f -a' };
      const positional = [...positionalOf(before, []), ...after];
      return classifyTargets(positional, base, 'git checkout-index -f');
    }
    case 'stash': {
      const first = wordValue(before[0]);
      const action = first?.startsWith('-') ? 'push' : (first ?? 'push');
      // `stash save <message>` は引数がメッセージで、対象は常に作業ツリー全体
      if (action === 'save') return { kind: 'all-dirty', base, why: 'git stash save' };
      if (!['push', '-p', '--patch'].includes(action)) return null;
      const rest = first === 'push' ? before.slice(1) : before;
      const positional = [...positionalOf(rest, ['-m', '--message'], ['m']), ...after];
      if (positional.length === 0)
        return { kind: 'all-dirty', base, why: 'git stash（対象指定なし）' };
      return classifyTargets(positional, base, 'git stash');
    }
    default:
      return null;
  }
}

/** git の索引に載っているパスか（作業ツリーに無くても追跡済みなら真）。 */
function isTracked(directory: string, path: string): boolean {
  const result = Bun.spawnSync(
    ['git', '-C', directory, 'ls-files', '--error-unmatch', '--', path],
    {
      stdout: 'ignore',
      stderr: 'ignore',
    },
  );
  return result.exitCode === 0;
}

/** フラグとその値を除いた位置引数。valued に挙げたフラグは次の語を値として読み飛ばす。
 *  bundledValuedSuffixes に挙げた文字で終わる束ねられた短縮オプション（例: -um = -u -m）も、
 *  次の語を値として読み飛ばす。 */
function positionalOf(
  words: ShellWord[],
  valued: string[],
  bundledValuedSuffixes: string[] = [],
): ShellWord[] {
  const result: ShellWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const value = wordValue(word);
    if (!word) continue;
    if (value !== undefined && valued.includes(value)) {
      i++;
      continue;
    }
    if (
      value !== undefined &&
      value.startsWith('-') &&
      !value.startsWith('--') &&
      value.length > 2 &&
      bundledValuedSuffixes.some((suffix) => value.endsWith(suffix))
    ) {
      i++;
      continue;
    }
    if (value?.startsWith('-')) continue;
    result.push(word);
  }
  return result;
}

function classifyTargets(targets: ShellWord[], base: string, why: string): Revert {
  if (targets.length === 0) return null;
  const values = targets.map(wordValue);
  const display = targets.map((word) => word.source).join(' ');
  if (values.some((value) => value !== undefined && WHOLE_TREE_TARGET.test(value)))
    return { kind: 'whole-tree', why: `${why} ${display}` };
  if (values.some((value) => value !== undefined && PATHSPEC_PATTERN.test(value)))
    return { kind: 'all-dirty', base, why: `${why} ${display}（glob / pathspec）` };
  if (values.some((value) => value === undefined))
    return { kind: 'all-dirty', base, why: `${why} ${display}（動的な対象）` };
  return { kind: 'paths', paths: values.filter((value) => value !== undefined), base };
}

// ---------------------------------------------------------------------------
// 2. 対象パスが「自分の変更」かを確かめる
// ---------------------------------------------------------------------------

/**
 * 対象のうち、自分の変更でない未コミット変更。相対パスは解析済みの Git 作業ツリーを基準に
 * 照合する。
 */
async function foreignChanges(targets: string[] | 'all', bases: string[]): Promise<string[]> {
  const mine = await readEditedFiles(input?.session_id);
  const foreign = new Set<string>();
  for (const base of new Set(bases)) {
    const dirty = await dirtyFiles(base);
    const hit =
      targets === 'all'
        ? dirty
        : dirty.filter((file) =>
            targets.some((target) => {
              const absolute = resolve(base, target);
              return file === absolute || file.startsWith(`${absolute}/`);
            }),
          );
    for (const file of hit) {
      // 自分が最後に書いた内容のままなら自分の変更。それ以外（記録なし、編集前の候補のまま、
      // 後から誰かが変えた）は他人の変更として扱う
      const recorded = mine.get(file);
      if (
        !recorded ||
        recorded === 'pending' ||
        recorded !== ((await ownershipFingerprint(file)) ?? 'deleted')
      )
        foreign.add(file);
    }
  }
  return [...foreign];
}

// ---------------------------------------------------------------------------
// 3. 判定
// ---------------------------------------------------------------------------

const origin = input?.cwd ?? process.cwd();
const parsed = parseCommands(command, origin);
if (parsed.kind === 'parse-error') {
  const first = parsed.errors[0];
  block(
    `Bash コマンドを解析できません（${first?.line ?? 1}行${first?.column ?? 1}列）。構文を修正してから再実行してください。`,
  );
}
const commands = parsed.commands;
const argumentValues = (entry: SimpleCommand) => entry.argv.slice(1).map(wordValue);
const hasLsof = commands.some(
  (entry) =>
    entry.name === 'lsof' &&
    argumentValues(entry).some(
      (value) => value?.startsWith('-') && value.includes('t') && value.includes('i'),
    ),
);
const hasKill = commands.some(
  (entry) =>
    entry.name === 'kill' ||
    (entry.name === 'xargs' && argumentValues(entry).some((value) => value === 'kill')),
);
const hasFuserKill = commands.some(
  (entry) => entry.name === 'fuser' && argumentValues(entry).some((value) => value === '-k'),
);
if ((hasLsof && hasKill) || hasFuserKill)
  block(
    'lsof+kill / fuser+kill はdevcontainerを巻き込みます。ps aux --sort=-%mem | head でPIDを確認し、kill <PID> で個別に止めてください。',
  );
for (const entry of commands) {
  if (!entry.direct || entry.name !== 'git') continue;
  const target = gitTarget(entry);
  if (wordValue(target.subcommand) !== 'worktree' || wordValue(target.args[0]) !== 'add') continue;
  const path = wordValue(target.args[1]);
  if (path === undefined || !path.startsWith('.claude/worktrees/'))
    block('worktreeは.claude/worktrees/配下に作成してください。');
}
const REVERT_SUBCOMMANDS = new Set([
  'restore',
  'checkout',
  'checkout-index',
  'switch',
  'stash',
  'clean',
  'reset',
]);
// Direct Git commands in pipelines are analyzed. Substitutions, wrappers, external scripts, and
// code produced by a pipeline are intentionally opaque; this is not a security boundary.

// 各コマンドの実行ディレクトリは AST の制御フロー解析結果をそのまま使う。
for (const entry of commands) {
  const values = entry.argv.map(wordValue);
  if (
    entry.direct &&
    entry.name === 'jj' &&
    values[1] === 'restore' &&
    values.some((value) => value === '--from' || value === '--to' || value === '--changes-in')
  )
    block('全ファイル対象のrevert/resetは禁止です。特定ファイルか専用worktreeを指定してください。');
  if (!entry.direct || entry.name !== 'git') continue;
  const revert = analyzeGit(entry);
  if (!revert) continue;
  if (revert.kind === 'whole-tree')
    block(
      `全ファイル対象のrevert/reset（${revert.why}）は禁止です。特定ファイルか専用worktreeを指定してください。`,
    );
  const foreign = await foreignChanges(revert.kind === 'all-dirty' ? 'all' : revert.paths, [
    revert.base,
  ]);
  if (foreign.length > 0)
    block(
      `次の未コミット変更は、このセッションの Write/Edit で書いたものではありません（ユーザーか別プロセスの作業の可能性、または編集前から差分があったファイル）:\n  ${foreign.join('\n  ')}\n巻き戻す前に、その変更を誰が何のために入れたかをユーザーに確認してください。自分が Bash 経由で書いた変更なら、その旨を伝えて確認を取ってから進めてください。`,
    );
}

// ---------------------------------------------------------------------------
// 4. 付随する検査
// ---------------------------------------------------------------------------

const root = await projectDirectory();
async function run(path: string, cwd?: string): Promise<void> {
  // project hook は bash と bun (TypeScript) の両方で書かれているため、
  // 拡張子で実行系を選ぶ。bun 固定だと .sh は構文エラーで落ち、glob を
  // *.ts に絞ると .sh は黙ってスキャン対象から外れる（後者で実際に
  // block-redash-direct-exec.sh / block-athena-exec.sh が発火しなくなる
  // 回帰が起きた）。
  const interpreter = path.endsWith('.sh') ? 'bash' : 'bun';
  const child = Bun.spawn([interpreter, join(root, path)], {
    cwd: root,
    env: process.env,
    stdin: new Blob([cwd ? JSON.stringify({ ...input, cwd }) : text]),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const status = await child.exited;
  if (status !== 0) process.exit(status);
}
if (isPrCreateCommand(command)) await run('.claude/hooks/require-pr-self-review.ts');
// PreToolUse はシェル全体の実行前に一度だけ動く。先行コマンドが HEAD を変えると、
// この時点で検査した SHA と実際に push される SHA が異なる。
const HEAD_MUTATIONS = new Set([
  'commit', 'merge', 'rebase', 'cherry-pick', 'revert', 'reset', 'checkout', 'switch',
  'pull', 'am', 'apply', 'stash',
]);
let pendingCommit = false;
for (const entry of commands) {
  if (!entry.direct || entry.name !== 'git') continue;
  const target = gitTarget(entry);
  const subcommand = wordValue(target.subcommand);
  if (subcommand === 'add' || subcommand === 'rm' || subcommand === 'mv' ||
      HEAD_MUTATIONS.has(subcommand ?? '')) pendingCommit = true;
  if (subcommand !== 'push') continue;
  if (pendingCommit)
    block('同じ Bash コマンド内で git add/commit 等の後に push すると、push 前に確定した HEAD をレビューできません。変更・commit を先に実行し、git push を別の Bash コマンドで実行してください。');
  if (target.directory.kind === 'known')
    await run('.claude/hooks/require-pr-feedback-review.ts', target.directory.path);
  else
    console.error('NOTICE: git push の作業ツリーを特定できません。LLM が送信先 PR のレビュー指摘を確認してください。');
}
for await (const path of new Glob('.claude/hooks/project/*.{ts,sh}').scan({ cwd: root }))
  await run(path);
