import { $ } from 'bun';
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
export interface HookInput {
  session_id?: string;
  hook_event_name?: string;
  tool_use_id?: string;
  cwd?: string;
  tool_input?: {
    file_path?: string;
    path?: string;
    command?: string;
    run_in_background?: boolean;
  };
  tool_response?: {
    exit_code?: number;
    exitCode?: number;
    duration_ms?: number;
    interrupted?: boolean;
  };
  stop_hook_active?: boolean;
}
/**
 * hook が状態ファイル（レビュー回数など）や設定を読み書きする基準ディレクトリ。
 * Claude Code は CLAUDE_PROJECT_DIR に主チェックアウトを入れて hook を起動する
 * （worktree に入っても変わらない）。未設定のときは --git-common-dir から同じ
 * 場所を導く。--show-toplevel だと linked worktree ごとに別の場所になり、
 * 記録側と判定側で見るファイルが食い違う。
 *
 * 編集中のファイルや検証対象のツリーを扱う hook は、こちらではなく
 * workingTree() を使う。
 */
export async function projectDirectory(): Promise<string> {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  const result = await $`git rev-parse --path-format=absolute --git-common-dir`.quiet().nothrow();
  return result.exitCode === 0 ? dirname(resolve(result.text().trim())) : process.cwd();
}
/**
 * hook が lint や検証をかける作業ツリーのトップレベル。Claude Code は hook 入力の
 * cwd にセッションの現在地を入れる（worktree に入ればその中、cd していれば
 * サブディレクトリ）。そこを起点に git のトップレベルを解く。cwd が無いときは
 * プロセスの現在地から解く。
 */
export async function workingTree(input?: HookInput | null): Promise<string> {
  const start = input?.cwd ?? process.cwd();
  const result = await $`git -C ${start} rev-parse --show-toplevel`.quiet().nothrow();
  return result.exitCode === 0 ? result.text().trim() : start;
}
/** 主チェックアウトの .git。linked worktree からでも同じ場所を指す。 */
export async function gitCommonDir(start: string = process.cwd()): Promise<string | null> {
  const result = await $`git -C ${start} rev-parse --path-format=absolute --git-common-dir`
    .quiet()
    .nothrow();
  return result.exitCode === 0 ? resolve(result.text().trim()) : null;
}
/** 現在のブランチ名。detached HEAD ではコミットの短い ID。 */
export async function currentBranch(start: string = process.cwd()): Promise<string> {
  const name = await $`git -C ${start} rev-parse --abbrev-ref HEAD`.quiet().nothrow();
  if (name.exitCode === 0 && name.text().trim() !== 'HEAD') return name.text().trim();
  return await headSha(start);
}
/** 現在の HEAD のフル SHA。作業ツリーの変更（staged/unstaged）は含まない。 */
export async function headSha(start: string = process.cwd()): Promise<string> {
  const result = await $`git -C ${start} rev-parse HEAD`.quiet().nothrow();
  return result.exitCode === 0 ? result.text().trim() : 'unknown';
}
/** `command` 内で、`word` が単語境界付きで最初に現れる位置を `from` 以降から探す。無ければ -1。 */
function indexOfWord(command: string, word: string, from: number): number {
  let index = command.indexOf(word, from);
  while (index !== -1) {
    const before = command[index - 1];
    const after = command[index + word.length];
    const boundaryBefore = before === undefined || !/\w/.test(before);
    const boundaryAfter = after === undefined || !/\w/.test(after);
    if (boundaryBefore && boundaryAfter) return index;
    index = command.indexOf(word, index + 1);
  }
  return -1;
}
/**
 * コマンド文字列が `gh pr create` を含むかを判定する。`gh --repo owner/repo pr create`
 * （gh の前）・`gh pr --repo owner/repo create`（pr の後）のどちらでもオプションを
 * 挟める上、シェルの行継続（`\` + 改行）や長いオプション値で語間が伸びることもあるため、
 * `gh` → `pr` → `create` の各語の間は改行を含めて上限なしで許す。
 *
 * 正規表現の遅延ワイルドカード（`[\s\S]*?`）で同じことをすると、`pr`/`create` が
 * 見つからない入力（長い heredoc など）で `gh` の出現ごとに再走査が起き、入力長に対して
 * 多項式的に遅くなる（実測: 約100KBの入力で 1.3 秒超）。3 語を順に 1 回ずつ
 * `indexOf` で探す線形走査にして、この種の入力でも遅くならないようにする。
 *
 * パイプ・セミコロンや別の Bash 呼び出しで区切られた無関係な内容まで拾う可能性はあるが、
 * これはブロック/reset のトリガー判定にしか使わない（誤検知しても追加のレビューを要求
 * するだけで、見逃しの方が実害が大きい）。
 */
export function isPrCreateCommand(command: string): boolean {
  const ghIndex = indexOfWord(command, 'gh', 0);
  if (ghIndex === -1) return false;
  const prIndex = indexOfWord(command, 'pr', ghIndex + 2);
  if (prIndex === -1) return false;
  return indexOfWord(command, 'create', prIndex + 2) !== -1;
}
/**
 * 実際に PR が作成されたかを、コマンドの終了コードではなく GitHub 側の状態で確認する。
 * `gh pr create || true` のような形で終了コードが上書きされていても、実際に PR が
 * 存在するかどうかで判定するため誤魔化されない。
 */
export async function hasOpenPrForCurrentBranch(tree: string): Promise<boolean> {
  // gh に git の -C 相当の引数は無いため、cwd で作業ツリーを指定する。
  const result = await $`gh pr view --json url -q .url`.cwd(tree).quiet().nothrow();
  return result.exitCode === 0 && result.text().trim().length > 0;
}
export async function readInput(): Promise<HookInput | null> {
  // 端末から手で実行したときは stdin が閉じないので読まずに済ませる。
  if (process.stdin.isTTY) return null;
  try {
    return await Bun.stdin.json();
  } catch {
    return null;
  }
}
/**
 * セッションを跨いで持ち越す状態の置き場。git 共通ディレクトリの親に置くので、worktree に入っても
 * 同じ場所を指す。git 管理外（.claude/.gitignore の .session/）。git リポジトリでなければ null。
 */
export async function sessionStateDir(): Promise<string | null> {
  const common = await $`git rev-parse --git-common-dir`.quiet().nothrow();
  if (common.exitCode !== 0) return null;
  const root = dirname(resolve(process.cwd(), common.text().trim()));
  return join(root, '.claude/.session');
}
/**
 * このセッションのエージェントが Write / Edit ツールで書いたファイルの記録。
 * 1 行 `絶対パス<TAB>ハッシュ`（編集前の候補は `pending`、他人の変更を含むと分かったものは `foreign`）。
 * 追記のみで、同じパスは後の行が優先する。
 * track-edits.ts が書き、pre-bash-guard.ts が「自分の変更か」の判定に使う。
 */
export async function editedFilesPath(sessionId: string | undefined): Promise<string | null> {
  const directory = await sessionStateDir();
  if (!directory) return null;
  return join(directory, `${sessionId ?? 'unknown'}.edited`);
}
/**
 * 絶対パス → 最後に自分が書いた内容のハッシュ（または 'pending' / 'foreign' / 'deleted'）。
 * 追記専用ログを毎回全行読み直すため、1 セッションで編集するファイル数に比例したコストがかかる。
 * 通常のセッションが数百ファイルを超えて編集することは無いため許容している。
 */
export async function readEditedFiles(sessionId: string | undefined): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const path = await editedFilesPath(sessionId);
  if (!path) return result;
  const file = Bun.file(path);
  if (!(await file.exists())) return result;
  const text = await file.text().catch(() => '');
  for (const line of text.split('\n')) {
    const [file, hash] = line.split('\t');
    if (file) result.set(file, hash ?? 'pending');
  }
  return result;
}
/** ファイル内容の SHA-256。読めなければ null。 */
export async function hashFile(path: string): Promise<string | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const bytes = await file.arrayBuffer().catch(() => null);
  if (!bytes) return null;
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}
/**
 * 「自分が最後に書いたときのまま」を判定するための指紋。内容のハッシュだけだと、
 * ユーザーが実行ビットだけを変えた（`chmod +x` 等）場合に見分けられず、内容は自分のものの
 * ままなので所有を持ち続けてしまう。実行ビットの有無を添えて、モードだけの変更でも
 * 所有を手放すようにする。
 */
export async function ownershipFingerprint(path: string): Promise<string | null> {
  const hash = await hashFile(path);
  if (hash === null) return null;
  let executable = false;
  try {
    executable = (statSync(path).mode & 0o111) !== 0;
  } catch {
    // 直前の hashFile 成功と後続の stat の間で消えた。存在しない扱いにする
    return null;
  }
  return `${hash}:${executable ? 'x' : '-'}`;
}
export async function hasMiseTask(name: string): Promise<boolean> {
  const found = await $`mise tasks ls --no-header`.quiet().nothrow();
  return (
    found.exitCode === 0 &&
    found
      .text()
      .split('\n')
      .some((line) => line.trim().split(/\s+/)[0] === name)
  );
}
/** SIGTERM を送ってから SIGKILL へ進むまでの猶予。 */
const SIGKILL_GRACE_MS = 5_000;
/** シグナルを送っても子孫がパイプを握り続ける場合に、読み取りを打ち切るまでの猶予。 */
const READ_CUTOFF_MS = 10_000;

export async function runMiseTask(name: string, args: string[], timeoutMs: number) {
  const child = Bun.spawn(['mise', 'run', '--quiet', name, '--', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  // 制限時間を実効にする。シグナルだけでは足りない: SIGTERM を無視するタスクがあり、
  // 直接の子を SIGKILL しても stdout/stderr を握った子孫は残るため、パイプの読み取りが
  // 終わらない。プロセスを確実に終わらせられなくても hook 自体は返す必要があるので、
  // シグナルの送出と読み取りの打ち切りを両方仕掛ける。
  let timedOut = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const cutoff = new Promise<void>((resolve) => {
    timers.push(
      setTimeout(() => {
        timedOut = true;
        child.kill();
        timers.push(setTimeout(() => child.kill('SIGKILL'), SIGKILL_GRACE_MS));
        timers.push(setTimeout(resolve, READ_CUTOFF_MS));
      }, timeoutMs),
    );
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    Promise.race([new Response(child.stdout).text(), cutoff.then(() => '')]),
    Promise.race([new Response(child.stderr).text(), cutoff.then(() => '')]),
    Promise.race([child.exited, cutoff.then(() => -1)]),
  ]);
  for (const timer of timers) clearTimeout(timer);
  return {
    exitCode,
    output: `${stdout}${stderr}`
      .replace(new RegExp(`^\\[${name}\\] ERROR task failed$`, 'gm'), '')
      .trim(),
    timedOut: timedOut || child.signalCode !== null,
  };
}
