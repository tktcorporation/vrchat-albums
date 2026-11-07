/**
 * 処理本体（utilityProcess）が予期せず終了したときに、起動し直すかを決める。
 *
 * 起動直後の失敗（DB を開けないなど）は何度起動し直しても同じ結果になりうるので、
 * 一定時間の中で決まった回数を超えたら諦め、利用者へ知らせて終了する。
 * 起動し直すまでの待ち時間は回数ごとに倍にし、すぐに落ちる処理本体を立て続けに起動しない。
 */
export interface RestartPolicyOptions {
  /** `windowMs` の間に起動し直してよい回数 */
  readonly maxRestarts: number;
  readonly windowMs: number;
  /** 1 回目の待ち時間。2 回目以降は倍にしていく */
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export type RestartDecision =
  | { readonly action: 'restart'; readonly delayMs: number }
  | { readonly action: 'giveUp'; readonly crashesInWindow: number };

/** 1 分のうちに 3 回まで、0.5 秒・1 秒・2 秒と間を空けて起動し直す */
export const DEFAULT_RESTART_POLICY: RestartPolicyOptions = {
  maxRestarts: 3,
  windowMs: 60_000,
  baseDelayMs: 500,
  maxDelayMs: 5_000,
};

/**
 * 予期しない終了を記録し、起動し直すかを返す関数を作る。
 *
 * @returns 終了した時刻（ミリ秒）を受け取り、判断を返す関数。時刻を引数にするのはテストが時計を差し替えるため
 */
export const createRestartPolicy = (
  options: RestartPolicyOptions = DEFAULT_RESTART_POLICY,
): ((crashedAtMs: number) => RestartDecision) => {
  let crashTimes: number[] = [];
  return (crashedAtMs) => {
    crashTimes = [
      ...crashTimes.filter((time) => crashedAtMs - time < options.windowMs),
      crashedAtMs,
    ];
    if (crashTimes.length > options.maxRestarts) {
      return { action: 'giveUp', crashesInWindow: crashTimes.length };
    }
    const delayMs = Math.min(
      options.baseDelayMs * 2 ** (crashTimes.length - 1),
      options.maxDelayMs,
    );
    return { action: 'restart', delayMs };
  };
};
