import { useEffect, useState } from 'react';

/** 進捗が止まって見え始めるまでの時間。通常のイベント間隔より長く、待たされ感が出る前に置く */
const DEFAULT_THRESHOLD_MS = 1500;

interface UseStalledOptions {
  thresholdMs?: number;
  /** false の間（完了・エラー後など）は止まっているとみなさない */
  active: boolean;
}

/**
 * `value` が `thresholdMs` の間変わらなかったら true を返す。値が変わるか `active` が false に
 * なった時点で false に戻る。
 *
 * 解除は描画中に行い、値が変わったその描画で false にする。タイマーの張り直しを待つと、
 * 以前止まった値へ戻ったとき（新しい実行が同じ値から始まったときなど）にしきい値を待たず
 * true になってしまうため。
 */
export const useStalled = (
  value: number,
  { thresholdMs = DEFAULT_THRESHOLD_MS, active }: UseStalledOptions,
): boolean => {
  const [stalled, setStalled] = useState(false);
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setStalled(false);
  }
  if (!active && stalled) {
    setStalled(false);
  }

  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setTimeout(() => setStalled(true), thresholdMs);
    return () => clearTimeout(timer);
  }, [value, active, thresholdMs]);

  return active && stalled;
};
