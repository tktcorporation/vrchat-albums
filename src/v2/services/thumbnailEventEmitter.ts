/**
 * サムネイルキャッシュ更新イベントエミッター
 *
 * ポーリング（setInterval）に代わるイベント駆動パターン。
 * キャッシュが更新された時に、該当するサムネイルを待っている
 * コンポーネントに通知する。
 *
 * ## なぜポーリングではなくイベント駆動か
 * - ポーリング: 50枚の写真 × 100ms間隔 = 500 calls/sec
 * - イベント駆動: キャッシュ更新時のみ通知（必要な時だけ）
 *
 * ## 使用例
 * ```ts
 * // キャッシュ更新時に通知
 * notifyCacheUpdate(photoPath, base64Data);
 *
 * // コンポーネントで購読
 * useEffect(() => {
 *   return subscribeToCacheUpdate(photoPath, (data) => {
 *     setThumbnail(data);
 *   });
 * }, [photoPath]);
 * ```
 */

type CacheUpdateListener = (data: string) => void;

// photoPath -> リスナーのセット
const listeners = new Map<string, Set<CacheUpdateListener>>();

/**
 * キャッシュ更新イベントを購読
 * @returns アンサブスクライブ関数
 */
export const subscribeToCacheUpdate = (
  photoPath: string,
  listener: CacheUpdateListener,
): (() => void) => {
  if (!listeners.has(photoPath)) {
    listeners.set(photoPath, new Set());
  }
  const pathListeners = listeners.get(photoPath);
  pathListeners?.add(listener);

  // Cleanup function
  return () => {
    pathListeners?.delete(listener);
    // 空のセットは削除してメモリリークを防ぐ
    if (pathListeners?.size === 0) {
      listeners.delete(photoPath);
    }
  };
};

/**
 * キャッシュ更新を通知
 * 該当するphotoPathを待っている全てのリスナーに通知
 *
 * @remarks
 * 各リスナーは個別にtry-catchで保護されている。
 * 1つのリスナーが例外をスローしても、他のリスナーへの通知は継続される。
 */
export const notifyCacheUpdate = (photoPath: string, data: string): void => {
  const pathListeners = listeners.get(photoPath);
  if (pathListeners) {
    for (const listener of pathListeners) {
      try {
        listener(data);
      } catch (error) {
        // リスナーのエラーは他のリスナーに影響させない
        console.error('Thumbnail cache listener error:', error);
      }
    }
  }
};

/**
 * 特定のphotoPathのリスナー数を取得（デバッグ用）
 */
export const getListenerCount = (photoPath: string): number => {
  return listeners.get(photoPath)?.size ?? 0;
};

/**
 * 全リスナーをクリア（テスト用）
 */
export const clearAllListeners = (): void => {
  listeners.clear();
};
