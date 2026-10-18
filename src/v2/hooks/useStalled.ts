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
 * どの値で止まったかを覚えておき、現在の値と一致するときだけ true にする。値が変わった描画で
 * すぐ false になり、タイマーの張り直しを待たない。
 */
export const useStalled = (
  value: number,
  { thresholdMs = DEFAULT_THRESHOLD_MS, active }: UseStalledOptions,
): boolean => {
  const [stalledAt, setStalledAt] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setTimeout(() => setStalledAt(value), thresholdMs);
    return () => clearTimeout(timer);
  }, [value, active, thresholdMs]);

  return active && stalledAt === value;
};
