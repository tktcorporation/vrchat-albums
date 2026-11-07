/**
 * Bash の `gh pr create` を、ゲートが対象を確定できる 1 つの形に限って受け付ける。
 *
 *   [cd <リテラルのパス> && ]... gh [-R <host/owner/repo>] pr [-R <host/owner/repo>] create|new [オプション]
 *
 * `gh pr new` は `gh pr create` の別名なので同じに扱う。オプションは `gh pr create --help` の
 * 一覧にあるものだけを、1 語ずつ（`-H <値>`・`--head <値>`・`--head=<値>`）書いた場合に受け付ける。
 * 短いオプションの連結（`-dH`）や値の直結（`-Hfeat`・`-H=feat`）、一覧に無いオプション、
 * 位置引数は、gh がどう読むかを再現せずに止める。
 *
 * さらに `-R <host/owner/repo>`（`--repo`）と `--head <branch>`（`-H`）の両方を必須にする。gh が自分で
 * 選ぶ base リポジトリと head の ref は、リモートの構成・`gh repo set-default`・追跡設定・手元の
 * リモート追跡ブランチで変わるので、ゲートはそれを再現せず、コマンドに書かれた対象だけを確かめる。
 *
 * この形なら、実行ディレクトリ（cd の行き先）・リポジトリ・head ブランチが実行前に決まる。
 * ラッパー（`timeout` など）、`bash -c`、
 * サブシェル、コマンド置換、変数を含むパス、`;`・`||`・パイプ、gh より前のブランチ切り替え、
 * 複数の `gh pr create` は、実際に何がどこで動くかを実行前に確定できないので受け付けない。
 * 文字列に `gh pr create`（`gh pr new`）を含むだけのコマンド（コミットメッセージなど）も同じく止める。
 *
 * GitHub の GraphQL を使えない実行環境では `gh pr create` が動かず、REST API が作成の手段になる。
 * REST API での作成は create-pr.ts が担い、`gh api` で `repos/<owner>/<repo>/pulls` へ直接 POST する
 * 呼び出しはここで止めてそちらへ案内する。任意の `gh api` の引数から作成の対象を確定するには gh と
 * シェルの解釈を再現する必要があるので、受け付ける形は設けない。
 */
import { basename, resolve } from 'node:path';
import { andChainArgv, parseCommands, wordValue, type ShellWord } from './command-parse.ts';
import { ghArgsCreatePr, indexOfWord, isPrCreateCommand, NON_LITERAL_WORD } from './hook-utils.ts';

export type PrCreateInvocation =
  /** コマンドに `gh pr create` が含まれない。 */
  | { kind: 'none' }
  /** 受け付けない形。理由はそのまま利用者へ見せる。 */
  | { kind: 'rejected'; reason: string }
  /** 受け付ける形。`repo`・`head`・`base` はコマンドの -R・--head・--base の値。 */
  | { kind: 'canonical'; cwd: string; repo: string; head: string; base?: string };

const REJECTED =
  'gh pr create は、それだけを単独のコマンドとして実行してください（先頭に `cd <リテラルのパス> &&` を付けるのは可）。' +
  'ラッパー（timeout など）、bash -c、サブシェル、コマンド置換、変数を含むパス、`;`・`||`・パイプでつないだ他のコマンド、' +
  '同じ Bash 呼び出しでのブランチ切り替えは、PR の対象を実行前に確定できないため受け付けません。' +
  'コミットメッセージや本文に `gh pr create` という文字列を書くだけなら、その文章をファイルに書いて `-F <ファイル>` で渡してください。';

const missingTarget = (missing: string): string =>
  `gh pr create には ${missing} の指定が必要です。` +
  '`gh pr create -R <host/owner/repo> --head <branch> ...`（`gh pr new` も同じ）の形で、' +
  '<host/owner/repo> を origin に持つチェックアウトから実行してください。';

const REPO_FLAGS = new Set(['-R', '--repo']);
const HEAD_FLAGS = new Set(['-H', '--head']);
const BASE_FLAGS = new Set(['-B', '--base']);
/** `gh pr create`（別名 `gh pr new`）のサブコマンド名。 */
const CREATE_SUBCOMMANDS = new Set(['create', 'new']);
/**
 * `gh pr create` が受け付けるオプションと、値を取るか（`gh pr create --help` の一覧）。
 * ここに無いものは、gh がどう読むかを確かめていないので受け付けない。
 */
const VALUE_OPTIONS = [
  '-a',
  '--assignee',
  '-B',
  '--base',
  '-b',
  '--body',
  '-F',
  '--body-file',
  '-H',
  '--head',
  '-l',
  '--label',
  '-m',
  '--milestone',
  '-p',
  '--project',
  '-r',
  '--reviewer',
  '-T',
  '--template',
  '-t',
  '--title',
  '--recover',
  '-R',
  '--repo',
];
const FLAG_OPTIONS = [
  '-d',
  '--draft',
  '--dry-run',
  '-e',
  '--editor',
  '-f',
  '--fill',
  '--fill-first',
  '--fill-verbose',
  '--no-maintainer-edit',
  '-w',
  '--web',
];
const CREATE_OPTIONS: ReadonlyMap<string, 'value' | 'flag'> = new Map([
  ...VALUE_OPTIONS.map((name) => [name, 'value'] as const),
  ...FLAG_OPTIONS.map((name) => [name, 'flag'] as const),
]);

const optionRejected = (word: string): string =>
  `gh pr create の引数 \`${word}\` は受け付けません。` +
  'オプションは `gh pr create --help` にあるものだけを、`-H <値>`・`--head <値>`・`--head=<値>` のように 1 語ずつ書いてください' +
  '（`-Hfeat`・`-H=feat`・`-dH` のような短いオプションの連結や、位置引数は使えません）。`gh` と `pr` の間、`pr` と `create` の間に置けるのは `-R`/`--repo` だけです。';

const literalValues = (argv: ShellWord[]): string[] => argv.map((word) => wordValue(word) ?? '');

/** `cd <path>` 1 語だけの移動なら、その行き先。`cd -` やオプション付きは受け付けない。 */
function cdTarget(argv: string[]): string | null {
  const [name, target, ...rest] = argv;
  if (name !== 'cd' || target === undefined || rest.length > 0) return null;
  if (target === '' || target.startsWith('-')) return null;
  return target;
}

type OptionsResult =
  | { kind: 'ok'; target: { repo?: string; head?: string; base?: string } }
  | { kind: 'rejected'; reason: string };

/**
 * `gh ... pr ... create|new ...` の引数から -R・--head・--base を取り出す。gh が引数をどう読むかを
 * ここで再現しきれない書き方（短いオプションの連結や値の直結、一覧に無いオプション、位置引数、
 * 同じ指定の重複）は、真似て解釈せずに止める。
 */
function ghPrCreateOptions(argv: string[]): OptionsResult {
  if (argv[0] !== 'gh') return { kind: 'rejected', reason: REJECTED };
  const found: { repo?: string; head?: string; base?: string } = {};
  let stage: 'gh' | 'pr' | 'create' = 'gh';
  for (let index = 1; index < argv.length; index++) {
    const word = argv[index] ?? '';
    if (stage !== 'create' && !word.startsWith('-')) {
      if (stage === 'gh' && word === 'pr') stage = 'pr';
      else if (stage === 'pr' && CREATE_SUBCOMMANDS.has(word)) stage = 'create';
      else return { kind: 'rejected', reason: REJECTED };
      continue;
    }
    const equals = word.startsWith('--') ? word.indexOf('=') : -1;
    const name = equals === -1 ? word : word.slice(0, equals);
    const kind = CREATE_OPTIONS.get(name);
    const shortOk = name.startsWith('--') || name.length === 2;
    const allowedHere = stage === 'create' || REPO_FLAGS.has(name);
    if (kind === undefined || !shortOk || !allowedHere || (kind === 'flag' && equals !== -1))
      return { kind: 'rejected', reason: optionRejected(word) };
    if (kind === 'flag') continue;
    const value = equals === -1 ? argv[++index] : word.slice(equals + 1);
    if (value === undefined || value === '')
      return { kind: 'rejected', reason: optionRejected(word) };
    const key = REPO_FLAGS.has(name)
      ? 'repo'
      : HEAD_FLAGS.has(name)
        ? 'head'
        : BASE_FLAGS.has(name)
          ? 'base'
          : null;
    if (key === null) continue;
    if (found[key] !== undefined) return { kind: 'rejected', reason: optionRejected(word) };
    found[key] = value;
  }
  if (stage !== 'create') return { kind: 'rejected', reason: REJECTED };
  return { kind: 'ok', target: found };
}

/** 引数の文字列をシェルのコマンドとして実行するコマンド。 */
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

/**
 * argv のうち、シェルのコマンドとして実行される引数が始まる位置。`bash -c '…'`・`sh -ec '…'`・
 * `eval '…'` のように、ラッパー越し（`timeout 5 bash -c`）も含めて探す。無ければ null。
 */
function shellArgumentStart(argv: readonly string[]): number | null {
  for (let index = 0; index < argv.length; index++) {
    const name = basename(argv[index] ?? '');
    if (name === 'eval') return index + 1;
    if (!SHELLS.has(name)) continue;
    const option = argv.findIndex((value, at) => at > index && /^-[a-z]*c[a-z]*$/u.test(value));
    if (option !== -1) return option + 1;
  }
  return null;
}

/** 語の値をコマンドとして解析し直す深さ。`bash -c` の入れ子を数段まで追えば足りる。 */
const MAX_NESTED_PARSE = 3;

/**
 * 構文解析した各コマンドの argv が `gh [オプション] pr [オプション] create|new` を含むか。サブコマンドの
 * 位置の判定は isPrCreateCommand と同じ ghArgsCreatePr に任せる。引用符で語を分割した
 * `g''h pr create` のように、文字列の走査（isPrCreateCommand）では見えない呼び出しを拾う。
 * `gh` は argv の先頭に限らずどの位置でも探す。`timeout 5 g''h pr create` のようなラッパー越しの
 * 呼び出しも、ラッパーの種類を列挙せずに検出し、受け付ける形ではないので止める。各語の値を
 * isPrCreateCommand にもかけ、`bash -c "gh pr create"` のような文字列の中の呼び出しも拾う。
 */
function parsedPrCreate(command: string, origin: string, depth = 0, executed = true): boolean {
  const parsed = parseCommands(command, origin);
  if (parsed.kind !== 'parsed') return false;
  // 上限まで入れ子になった文字列は、中身を確かめずに `gh` という語の有無だけで決める。引用符で
  // 分けた `g''h` も見えるよう、文字列そのものと解析した語の値の両方を探す。`gh` を含まない
  // コミットメッセージや `ssh host "bash -c '…'"` の入れ子は PR 作成として扱わない。
  if (depth >= MAX_NESTED_PARSE)
    return [command, ...parsed.commands.flatMap((entry) => entry.argv.map(wordValue))].some(
      (value) => value !== undefined && indexOfWord(value, 'gh', 0) !== -1,
    );
  const literalCommand = parsed.commands.some((entry) => {
    // 値を確定できない語（変数展開・コマンド置換）は、ghArgsCreatePr が実行時の値を仮定して判定する。
    // `gh` の直後（pr の位置）の語が実行時まで決まらないことを数えるのは、実行される最上位のコマンドだけ。
    // 引用符の中の文字列を解き直した段では、`git commit -m 'bump gh $VERSION'` のような文章にも当たるため。
    const argv = entry.argv.map((word) => wordValue(word) ?? NON_LITERAL_WORD);
    if (argv.some((value) => isPrCreateCommand(value))) return true;
    // `bash -c "g''h pr create"` のように、語の値そのものがコマンドとして解釈されうる。
    const runsFrom = shellArgumentStart(argv);
    if (
      argv
        .slice(1)
        .some((value, index) =>
          parsedPrCreate(value, origin, depth + 1, runsFrom !== null && index + 1 >= runsFrom),
        )
    )
      return true;
    return argv.some(
      (value, index) =>
        (basename(value) === 'gh' &&
          ghArgsCreatePr(argv.slice(index + 1), { dynamicCommand: depth === 0 })) ||
        // `timeout 5 "$GH" pr create` のように、ラッパー越しに実行する語が実行時まで決まらない。
        // 実行されない文字列（コミットメッセージや本文）の中の `$GH pr new` は数えない。
        (executed && value === NON_LITERAL_WORD && ghArgsCreatePr(argv.slice(index + 1))),
    );
  });
  if (literalCommand) return true;
  // `GH=gh; "$GH" pr create` のように、実行するコマンドの語そのものが実行時まで決まらなくても、
  // 続く語が `pr` とサブコマンドの位置の create/new なら gh でありうる。`pr` の位置は値の確定した
  // 語だけを数え、`"$EDITOR" notes.txt` や `"$X" pr list` は対象にしない。実行されない文字列を
  // 解き直した段（`git commit -m 'Use $GH pr new flow'`）では数えない。
  if (!executed) return false;
  return parsed.dynamicCommands.some((words) => {
    const argv = words.map((word) => wordValue(word) ?? NON_LITERAL_WORD);
    return argv.slice(1).some((value) => isPrCreateCommand(value)) || ghArgsCreatePr(argv.slice(1));
  });
}

/**
 * `cd <リテラルのパス> &&` の連なりと最後の 1 コマンドに分け、cd を解いた実行ディレクトリを返す。
 * それ以外のつなぎ方（`;`・`||`・パイプ、cd 以外の前置コマンド）なら null。
 */
function cdChain(command: string, origin: string): { cwd: string; last: string[] } | null {
  const chain = andChainArgv(command)?.map(literalValues);
  const last = chain?.at(-1);
  if (!chain || !last) return null;
  let cwd = origin;
  for (const argv of chain.slice(0, -1)) {
    const target = cdTarget(argv);
    if (target === null) return null;
    cwd = resolve(cwd, target);
  }
  return { cwd, last };
}

const API_REJECTED =
  'REST API で PR を作成するときは、`gh api` を直接呼ばず `bun .claude/hooks/create-pr.ts --title <タイトル> --body-file <本文のファイル> [--draft]` を使ってください。' +
  'このスクリプトは現在のブランチと origin から対象を決め、レビュー収束の証跡を確かめてから作成します。' +
  'コミットメッセージや本文にこの呼び出しを書くだけなら、その文章をファイルに書いて `-F <ファイル>` で渡してください。';

/** PR の一覧と作成のエンドポイント（gh と同じく先頭の `/`・クエリ・フラグメント・GHES の `api/v3/` を除いたパス）。 */
const PULLS_PATH = /^repos\/[^/]+\/[^/]+\/pulls$/iu;
/** gh api がリクエストに本文を付ける（既定のメソッドを POST にする）オプション。 */
const API_BODY_OPTIONS = new Set(['-f', '--raw-field', '-F', '--field', '--input']);

function endpointPath(endpoint: string): string {
  const url = /^(?:https?:)?\/\/[^/]+\/(.*)$/iu.exec(endpoint);
  return (url ? (url[1] ?? '') : endpoint)
    .replace(/[?#].*$/su, '')
    .replace(/^\/+/u, '')
    .replace(/^api\/v3\//iu, '')
    .replace(/\/+$/u, '');
}

/**
 * `gh api` に続く引数（`api` 自身は含まない）が、PR の一覧・作成のエンドポイントへの書き込みか。
 * gh は `-X`/`--method` を省くと、本文のオプションがあれば POST、無ければ GET にする（最後の指定が勝つ）。
 * 値の決まらない語は数えない。対象を実行時に組み立てる呼び出しまでは追わない
 * （このゲートが防ぐのは収束の記録忘れで、意図的な回避ではない）。
 */
function writesPullsCollection(args: readonly string[]): boolean {
  let method: string | undefined;
  let hasBody = false;
  let pulls = false;
  for (const [index, word] of args.entries()) {
    const previous = args[index - 1];
    if (previous === '-X' || previous === '--method') method = word;
    else if (word.startsWith('--method=')) method = word.slice('--method='.length);
    else if (word.startsWith('-X') && word.length > 2) method = word.slice(2);
    if (API_BODY_OPTIONS.has(word) || /^(?:--(?:raw-field|field|input)=|-[fF].)/u.test(word))
      hasBody = true;
    if (!word.startsWith('-') && PULLS_PATH.test(endpointPath(word))) pulls = true;
  }
  const effective = method?.toUpperCase() ?? (hasBody ? 'POST' : 'GET');
  if (effective === 'GET') return false;
  // GraphQL の createPullRequest も PR の作成になる
  if (args.some((word) => endpointPath(word) === 'graphql'))
    return args.some((word) => /createPullRequest/iu.test(word));
  return pulls && effective === 'POST';
}

/**
 * コマンド文字列に含まれる `gh api` の呼び出しの引数を、構文解析した argv から集める。引用符の中の
 * 文字列（`bash -c '…'` など）も解き直して探す。
 */
function ghApiArgs(command: string, origin: string, depth = 0): string[][] {
  const parsed = parseCommands(command, origin);
  if (parsed.kind !== 'parsed') return [];
  const found: string[][] = [];
  for (const entry of parsed.commands) {
    const argv = entry.argv.map((word) => wordValue(word) ?? NON_LITERAL_WORD);
    argv.forEach((value, index) => {
      if (basename(value) === 'gh' && argv[index + 1] === 'api') found.push(argv.slice(index + 2));
    });
    if (depth < MAX_NESTED_PARSE)
      for (const value of argv.slice(1))
        if (value !== NON_LITERAL_WORD) found.push(...ghApiArgs(value, origin, depth + 1));
  }
  return found;
}

/**
 * `gh api` で PR を直接作成する呼び出し（`repos/<owner>/<repo>/pulls` への POST）を止め、
 * レビュー収束の証跡を確かめてから作成する create-pr.ts へ案内する。一覧の取得や、
 * PR の作成でない書き込み（コメント・レビュー依頼など）は対象にしない。
 */
function apiPrCreateInvocation(command: string, origin: string): PrCreateInvocation {
  if (indexOfWord(command, 'api', 0) === -1) return { kind: 'none' };
  return ghApiArgs(command, origin).some(writesPullsCollection)
    ? { kind: 'rejected', reason: API_REJECTED }
    : { kind: 'none' };
}

/** Bash の入力文字列が PR 作成（`gh pr create`・`gh pr new`・REST API）を含むなら、受け付ける形かを判定する。 */
export function prCreateInvocation(command: string, origin: string): PrCreateInvocation {
  const api = apiPrCreateInvocation(command, origin);
  if (api.kind !== 'none') return api;
  if (!isPrCreateCommand(command) && !parsedPrCreate(command, origin)) return { kind: 'none' };
  const chain = cdChain(command, origin);
  if (chain === null) return { kind: 'rejected', reason: REJECTED };
  const { cwd, last } = chain;
  const options = ghPrCreateOptions(last);
  if (options.kind === 'rejected') return options;
  const { repo, head, base } = options.target;
  if (repo === undefined || head === undefined) {
    const missing = [
      repo === undefined ? '-R/--repo' : null,
      head === undefined ? '--head/-H' : null,
    ]
      .filter((name) => name !== null)
      .join(' と ');
    return { kind: 'rejected', reason: missingTarget(missing) };
  }
  return { kind: 'canonical', cwd, repo, head, ...(base === undefined ? {} : { base }) };
}
