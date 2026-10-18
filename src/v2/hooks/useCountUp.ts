import { useEffect, useRef, useState } from 'react';

/** 数え上げにかける時間。進捗がまとめて届いたときに、飛んだと感じない程度に短くする */
const DEFAULT_DURATION_MS = 600;

/** 序盤に速く進み終盤に減速させ、到着点で止まったように見せる */
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

interface UseCountUpOptions {
  durationMs?: number;
  /** true のときは数え上げずに目標値をそのまま返す（動きを減らす設定など） */
  disabled?: boolean;
}

/**
 * 目標値が増えたとき、表示値を現在の表示値から目標値まで短時間で数え上げる。
 *
 * 表示値は目標値を超えず、途中で減ることもない。目標値が減ったとき（新しい実行が 0 から
 * 始まったときなど）は逆向きに数えず、その値へ即座に合わせる。数え上げの途中で目標値が
 * さらに増えたら、その時点の表示値から新しい目標値へ数え直す。
 */
export const useCountUp = (
  target: number,
  {
    durationMs = DEFAULT_DURATION_MS,
    disabled = false,
  }: UseCountUpOptions = {},
): number => {
  const [animated, setAnimated] = useState(target);
  // 描画をまたいで「いま画面に出している値」を数え直しの起点にするため ref でも持つ
  const shownRef = useRef(target);

  useEffect(() => {
    const from = Math.min(shownRef.current, target);
    shownRef.current = from;
    if (disabled || from === target) {
      // 減った・変わらない・動きを止める場合は、次の描画で目標値に揃えるだけにする
      shownRef.current = target;
      const frame = requestAnimationFrame(() => setAnimated(target));
      return () => cancelAnimationFrame(frame);
    }

    let frame = 0;
    let startedAt: number | null = null;
    const step = (now: number) => {
      startedAt ??= now;
      const t = Math.min(1, (now - startedAt) / durationMs);
      const value = Math.round(from + (target - from) * easeOutCubic(t));
      shownRef.current = value;
      setAnimated(value);
      if (t < 1) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, disabled, durationMs]);

  // effect が走る前の描画でも、目標値を超えた値や数え上げ前の古い値を出さない
  return disabled ? target : Math.min(animated, target);
};
