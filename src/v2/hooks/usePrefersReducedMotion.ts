import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * matchMedia を持たない環境（jsdom など）では「動きを減らす指定なし」として扱う。
 * CSS 側の `motion-reduce:` と同じ問い合わせを使い、JS で動かす表示も同じ設定に従わせる。
 */
const mediaQueryList = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY)
    : null;

const subscribe = (onChange: () => void): (() => void) => {
  const list = mediaQueryList();
  list?.addEventListener('change', onChange);
  return () => list?.removeEventListener('change', onChange);
};

const getSnapshot = (): boolean => mediaQueryList()?.matches ?? false;

/**
 * OS の「視差効果を減らす」設定が有効か。設定が変わったら再描画する。
 */
export const usePrefersReducedMotion = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, () => false);
