/**
 * アプリを開いてからギャラリーを出すまでの流れ（規約の同意 → 初期化 → 初期設定またはエラー → ギャラリー）を、
 * 1 つの状態と、その状態を進める純粋な関数で表す。
 *
 * どの画面を出すかは `EntryState.phase` だけで決まり、初期化のような副作用は
 * `useEntryFlow` がその段階に入ったときにだけ始める。画面の順番を決める場所をここに 1 つにまとめることで、
 * 同意前に初期化が走る・画面ごとに別々の条件で出し分ける、といった食い違いを作れなくしている。
 */
import { match, P } from 'ts-pattern';

import { ERROR_CATEGORIES, type ParsedErrorInfo } from '../types/errors';

/** 規約の同意画面を出す理由。`new` は未同意、`update` は同意済みの版が現在の版と異なる */
export type TermsReason = 'new' | 'update';

/** 保存されている同意状況を、現在の規約の版と照らした結論 */
export type TermsDecision =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'required'; readonly reason: TermsReason };

/**
 * 起動の流れの段階。
 *
 * `attempt` は初期化を何回目に始めたかを表す。再試行のたびに増え、古い試行の結果が
 * 後から届いても今の試行の結果と取り違えないようにする。
 */
export type EntryState =
  | { readonly phase: 'checkingTerms' }
  | { readonly phase: 'termsUnavailable'; readonly error: unknown }
  | { readonly phase: 'termsRequired'; readonly reason: TermsReason }
  | { readonly phase: 'initializing'; readonly attempt: number }
  | { readonly phase: 'setupRequired'; readonly attempt: number }
  | {
      readonly phase: 'initFailed';
      readonly attempt: number;
      readonly error: ParsedErrorInfo;
    }
  | { readonly phase: 'ready' };

export type EntryEvent =
  | { readonly type: 'termsChecked'; readonly decision: TermsDecision }
  | { readonly type: 'termsCheckFailed'; readonly error: unknown }
  | { readonly type: 'termsAccepted' }
  | { readonly type: 'initSucceeded'; readonly attempt: number }
  | {
      readonly type: 'initFailed';
      readonly attempt: number;
      readonly error: ParsedErrorInfo;
    }
  | { readonly type: 'retry' };

export const initialEntryState: EntryState = { phase: 'checkingTerms' };

const FIRST_ATTEMPT = 1;

/**
 * 保存されている同意状況から、同意画面を出すかを決める。
 * 同意済みでも版が異なれば、規約が更新されたものとして同意し直してもらう。
 */
export const decideTerms = (
  saved: { readonly accepted: boolean; readonly version: string },
  currentVersion: string,
): TermsDecision => {
  if (!saved.accepted) {
    return { kind: 'required', reason: 'new' };
  }
  if (saved.version !== currentVersion) {
    return { kind: 'required', reason: 'update' };
  }
  return { kind: 'accepted' };
};

/**
 * 初期化の失敗を、利用者に初期設定を求めるものとそれ以外に分ける。
 * 写真やログのフォルダが見つからない失敗は、設定し直せば進めるので初期設定画面へ送る。
 */
const afterInitFailure = (attempt: number, error: ParsedErrorInfo) =>
  error.category === ERROR_CATEGORIES.SETUP_REQUIRED
    ? ({ phase: 'setupRequired', attempt } as const)
    : ({ phase: 'initFailed', attempt, error } as const);

/**
 * 起動の流れを 1 段進める。今の段階で意味を持たない出来事は無視し、状態をそのまま返す
 * （同じ参照を返すので React は再描画しない）。
 */
export const reduceEntryFlow = (
  state: EntryState,
  event: EntryEvent,
): EntryState =>
  match([state, event] as const)
    .returnType<EntryState>()
    .with(
      [{ phase: 'checkingTerms' }, { type: 'termsChecked' }],
      ([, { decision }]) =>
        match(decision)
          .returnType<EntryState>()
          .with({ kind: 'accepted' }, () => ({
            phase: 'initializing',
            attempt: FIRST_ATTEMPT,
          }))
          .with({ kind: 'required' }, ({ reason }) => ({
            phase: 'termsRequired',
            reason,
          }))
          .exhaustive(),
    )
    .with(
      [{ phase: 'checkingTerms' }, { type: 'termsCheckFailed' }],
      ([, { error }]) => ({ phase: 'termsUnavailable', error }),
    )
    .with([{ phase: 'termsUnavailable' }, { type: 'retry' }], () => ({
      phase: 'checkingTerms',
    }))
    .with([{ phase: 'termsRequired' }, { type: 'termsAccepted' }], () => ({
      phase: 'initializing',
      attempt: FIRST_ATTEMPT,
    }))
    .with(
      [{ phase: 'initializing' }, { type: 'initSucceeded' }],
      ([current, { attempt }]) =>
        attempt === current.attempt ? { phase: 'ready' } : current,
    )
    .with(
      [{ phase: 'initializing' }, { type: 'initFailed' }],
      ([current, { attempt, error }]) =>
        attempt === current.attempt
          ? afterInitFailure(attempt, error)
          : current,
    )
    .with(
      [{ phase: P.union('setupRequired', 'initFailed') }, { type: 'retry' }],
      ([current]) => ({ phase: 'initializing', attempt: current.attempt + 1 }),
    )
    .otherwise(() => state);

/**
 * 規約に同意した後の段階か。エラー監視の開始やアップデート確認のように、
 * 同意を得てから一度だけ始める処理の条件に使う。同意後の段階から同意前へ戻る遷移は無いので、
 * 一度 true になれば以後は変わらない。
 */
export const hasConsented = (state: EntryState): boolean =>
  match(state.phase)
    .with(
      P.union('checkingTerms', 'termsUnavailable', 'termsRequired'),
      () => false,
    )
    .with(
      P.union('initializing', 'setupRequired', 'initFailed', 'ready'),
      () => true,
    )
    .exhaustive();
