/**
 * レビューループの記録形式と、収束・振り返りの判定。副作用を持たない純粋なルールだけを置く。
 * ファイルの読み書きは review-count.ts、コマンドの入出力は record-pr-review.ts が担う。
 */

export type Reviewer = 'codex' | 'other';

export interface Round {
  /** レビュアーが挙げた指摘件数。accepted なラウンドでも実際の件数を残す（虚偽記録にしない）。 */
  count: number;
  /** このラウンドがレビューした HEAD の SHA。収束後に別のコミットが乗ったら無効にする。 */
  sha: string;
  reviewer: Reviewer;
  /**
   * 途中収束（直しても指摘の根本原因が変わらない）で、ユーザーが残る指摘を受け入れた
   * ラウンド。件数が 0 でなくても収束の対象になる。
   */
  accepted: boolean;
}

/** ラウンドの記録に付けられるフラグ。記録形式と CLI の引数は、どちらもこの配列から導く。 */
export const ROUND_FLAGS = ['codex', 'accepted'] as const;
export type RoundFlag = (typeof ROUND_FLAGS)[number];
export const isRoundFlag = (value: string): value is RoundFlag =>
  (ROUND_FLAGS as readonly string[]).includes(value);
export const roundFromFlags = (count: number, sha: string, flags: readonly RoundFlag[]): Round => ({
  count,
  sha,
  reviewer: flags.includes('codex') ? 'codex' : 'other',
  accepted: flags.includes('accepted'),
});
/** 各フラグが立つ条件。フラグを足すと、ここに対応を書かない限り型エラーになる。 */
const FLAG_IS_SET: Record<RoundFlag, (round: Round) => boolean> = {
  codex: (round) => round.reviewer === 'codex',
  accepted: (round) => round.accepted,
};
const flagsOf = (round: Round): RoundFlag[] =>
  ROUND_FLAGS.filter((flag) => FLAG_IS_SET[flag](round));

/**
 * 振り返りの決定。continue は方針を変えずに続ける、replan は方針を変える、asked は
 * ユーザーに確認して指示を得た。いずれも記録するエージェント自身の申告で、hook は検証しない。
 */
export const CHECKPOINT_DECISIONS = ['continue', 'replan', 'asked'] as const;
export type CheckpointDecision = (typeof CHECKPOINT_DECISIONS)[number];
/** ユーザーへの確認が必須のとき、受理される唯一の決定。 */
export const ASKED = 'asked' satisfies CheckpointDecision;

export type Entry =
  | { kind: 'round'; round: Round }
  | { kind: 'checkpoint'; decision: CheckpointDecision; sha: string; note: string };

export const roundsOf = (entries: Entry[]): Round[] =>
  entries.flatMap((entry) => (entry.kind === 'round' ? [entry.round] : []));

// ---- 記録形式 -------------------------------------------------------------
// 1 行 1 件。ラウンドは "<件数> <sha> [codex] [accepted]"、
// 振り返りは "checkpoint <decision> <sha> <診断メモ>"（メモは省略されることがある）。

// SHA-1(40桁)・SHA-256(64桁)のどちらでも読めるようにする。
const SHA = '[0-9a-f]{40}|[0-9a-f]{64}';
const ROUND_LINE = new RegExp(
  `^(\\d+)\\s+(${SHA})((?:\\s+(?:${ROUND_FLAGS.join('|')}))*)$`,
);
const CHECKPOINT_LINE = new RegExp(
  `^checkpoint\\s+(${CHECKPOINT_DECISIONS.join('|')})\\s+(${SHA})(?:\\s+(.+))?$`,
);

function parseEntry(line: string): Entry | null {
  const text = line.trim();
  const round = text.match(ROUND_LINE);
  if (round) {
    const flags = round[3].trim().split(/\s+/).filter(isRoundFlag);
    return { kind: 'round', round: roundFromFlags(Number(round[1]), round[2], flags) };
  }
  const checkpoint = text.match(CHECKPOINT_LINE);
  if (checkpoint) {
    return {
      kind: 'checkpoint',
      decision: checkpoint[1] as CheckpointDecision,
      sha: checkpoint[2],
      note: checkpoint[3] ?? '',
    };
  }
  return null;
}

export const parseEntries = (text: string): Entry[] =>
  text
    .split('\n')
    .map(parseEntry)
    .filter((entry): entry is Entry => entry !== null);

/** 診断メモは 1 行で持つ。改行や連続する空白は 1 つの空白に畳む。 */
export const normalizeNote = (note: string): string => note.replace(/\s+/g, ' ').trim();

function formatEntry(entry: Entry): string {
  if (entry.kind === 'checkpoint') {
    const note = normalizeNote(entry.note);
    const head = `checkpoint ${entry.decision} ${entry.sha}`;
    return note ? `${head} ${note}` : head;
  }
  const flags = flagsOf(entry.round).join(' ');
  const head = `${entry.round.count} ${entry.round.sha}`;
  return flags ? `${head} ${flags}` : head;
}

export const formatEntries = (entries: Entry[]): string =>
  `${entries.map(formatEntry).join('\n')}\n`;

// ---- 収束 -----------------------------------------------------------------

/**
 * 収束の判定: 2 ラウンド以上あり、最後のラウンドが codex review で現在の HEAD をレビューした
 * ものであり、かつ「指摘 0 件」または「ユーザーが残る指摘を受け入れた(accepted)」（
 * `.claude/rules/pr-self-review.md` の必須条件）。
 *
 * 「いずれかのラウンドが codex」ではなく「最後のラウンドが codex」を要求する: 前者だと
 * 古いコミットに対する codex の指摘ありラウンドの後、別コミットへ進んだ状態を非 codex の
 * ラウンドだけで収束させられてしまい、codex が最終形を見ないまま通ってしまう。
 *
 * accepted を認めるのは、途中収束（直しても指摘の根本原因が変わらない）をユーザーが受け入れた
 * 場合に、実際には指摘が残っているのに 0 件と偽って記録させないため。
 */
export const MIN_ROUNDS = 2;
export type Convergence =
  | { kind: 'converged' }
  | { kind: 'too_few'; missing: number }
  | { kind: 'not_codex' }
  | { kind: 'findings_left' }
  | { kind: 'stale_sha' };
export function judgeConvergence(rounds: Round[], currentSha: string): Convergence {
  const last = rounds.at(-1);
  if (last === undefined || rounds.length < MIN_ROUNDS) {
    return { kind: 'too_few', missing: MIN_ROUNDS - rounds.length };
  }
  if (last.reviewer !== 'codex') return { kind: 'not_codex' };
  if (last.count !== 0 && !last.accepted) return { kind: 'findings_left' };
  if (last.sha !== currentSha) return { kind: 'stale_sha' };
  return { kind: 'converged' };
}
export const isConverged = (rounds: Round[], currentSha: string): boolean =>
  judgeConvergence(rounds, currentSha).kind === 'converged';

export function assertNever(value: never): never {
  throw new Error(`未対応の分岐です: ${JSON.stringify(value)}`);
}

/** 収束していない理由の文言。記録コマンドと PR 作成のゲートが同じ文言を出す。 */
export function convergenceReason(convergence: Exclude<Convergence, { kind: 'converged' }>): string {
  switch (convergence.kind) {
    case 'too_few':
      return `ラウンドが ${MIN_ROUNDS} 回に達していません（あと ${convergence.missing} ラウンド）`;
    case 'not_codex':
      return '最後のラウンドが codex review ではありません';
    case 'findings_left':
      return '最後のラウンドに指摘が残っています（ユーザーが受け入れた場合は accepted を付けて記録する）';
    case 'stale_sha':
      return '収束後に別のコミットが乗っています。現在の HEAD で codex review が必要です';
    default:
      return assertNever(convergence);
  }
}

// ---- 振り返り -------------------------------------------------------------

/**
 * 直近の振り返りから数えて、このラウンド数に達したら次の振り返りが済むまで、収束しない
 * ラウンドを記録させない。収束しないレビューループは、エージェント自身が「収束していない」と
 * 気づく前に何ラウンドも回り続けるため、気づきに頼らず一定間隔で必ず立ち止まらせる。
 */
export const CHECKPOINT_INTERVAL = 3;
/**
 * ブランチのラウンドがこの数に達したら、指摘件数の傾向に関係なく、振り返りでユーザーへの
 * 確認を必須にする。件数は確率的に減ることがあり、レビューが長引いた事実そのものが、
 * 構造の見直しを促す十分な合図になる。振り返り間隔の整数倍にするので、この閾値に達した
 * 以降の振り返りは、すべて確認が必須になる。
 */
export const LONG_REVIEW_ROUNDS = CHECKPOINT_INTERVAL * 2;
/** 診断メモの最小文字数。指摘の分類・構造的原因・他の解決策の検討を 1 文は書かせる。 */
export const MIN_NOTE_LENGTH = 30;

/** 通常の続行を止めて、再計画またはユーザー確認が必要になる理由。 */
export type CheckpointReason = { kind: 'stalled' } | { kind: 'long'; totalRounds: number };

interface Progress {
  /** 直近の振り返り以降のラウンドの指摘件数。 */
  counts: number[];
  /** このブランチで記録済みのラウンドの総数。 */
  totalRounds: number;
}
export type ClearState = Progress & { status: 'clear' };
/** 振り返りが済むまで、収束しないラウンドを記録できない。 */
export type DueState = Progress & { status: 'due'; reason: CheckpointReason | null };
export type CheckpointState = ClearState | DueState;

/** 直近の窓で、最後の件数が窓内の最良値を更新していない。最後が 0 件か accepted なら停滞ではない。 */
function isStalled(recent: Round[]): boolean {
  const last = recent.at(-1);
  if (last === undefined || last.count === 0 || last.accepted) return false;
  return last.count >= Math.min(...recent.slice(0, -1).map((round) => round.count));
}

export function checkpointState(entries: Entry[]): CheckpointState {
  const lastCheckpoint = entries.findLastIndex((entry) => entry.kind === 'checkpoint');
  const window = roundsOf(entries.slice(lastCheckpoint + 1));
  const counts = window.map((round) => round.count);
  const totalRounds = roundsOf(entries).length;
  if (window.length < CHECKPOINT_INTERVAL) return { status: 'clear', counts, totalRounds };
  // 長期化したレビューは、件数が停滞しているかに関係なくユーザーの判断を要する。
  const reason: CheckpointReason | null =
    totalRounds >= LONG_REVIEW_ROUNDS
      ? { kind: 'long', totalRounds }
      : isStalled(window.slice(-CHECKPOINT_INTERVAL))
        ? { kind: 'stalled' }
        : null;
  return { status: 'due', counts, totalRounds, reason };
}

// ---- 判定 -----------------------------------------------------------------

export type RoundVerdict =
  /** 記録してよい。entries は追記後の全記録、next は追記後の振り返りの状態。 */
  | { kind: 'record'; entries: Entry[]; convergence: Convergence; next: CheckpointState }
  /** 振り返りが済むまで記録できない。 */
  | { kind: 'blocked'; state: DueState };

/**
 * 収束するラウンドは止めない。止めるのは、振り返りをせずに収束しないループを続けることだけ。
 * ブロックしたラウンドは記録しないので、呼び出し側は振り返りの後に同じラウンドを記録し直す。
 * 保留したラウンドは次の窓の最初のラウンドになり、その傾向は次の振り返りで判定する。
 * 振り返りが判定するのは、記録済みの窓のラウンドだけである。
 */
export function judgeRound(entries: Entry[], round: Round): RoundVerdict {
  const appended: Entry[] = [...entries, { kind: 'round', round }];
  const convergence = judgeConvergence(roundsOf(appended), round.sha);
  const before = checkpointState(entries);
  if (before.status === 'due' && convergence.kind !== 'converged') {
    return { kind: 'blocked', state: before };
  }
  return { kind: 'record', entries: appended, convergence, next: checkpointState(appended) };
}

export type CheckpointRejection =
  | { kind: 'not_due'; counts: number[] }
  | { kind: 'must_ask'; reason: CheckpointReason; counts: number[] }
  | { kind: 'note_too_short' };
export type CheckpointVerdict =
  | { kind: 'accept'; entries: Entry[] }
  | { kind: 'reject'; rejection: CheckpointRejection };

export function judgeCheckpoint(
  entries: Entry[],
  decision: CheckpointDecision,
  note: string,
  sha: string,
): CheckpointVerdict {
  const state = checkpointState(entries);
  if (state.status === 'clear') {
    return { kind: 'reject', rejection: { kind: 'not_due', counts: state.counts } };
  }
  if (state.reason !== null && decision !== ASKED) {
    return {
      kind: 'reject',
      rejection: { kind: 'must_ask', reason: state.reason, counts: state.counts },
    };
  }
  const text = normalizeNote(note);
  if (text.length < MIN_NOTE_LENGTH) {
    return { kind: 'reject', rejection: { kind: 'note_too_short' } };
  }
  return {
    kind: 'accept',
    entries: [...entries, { kind: 'checkpoint', decision, sha, note: text }],
  };
}
