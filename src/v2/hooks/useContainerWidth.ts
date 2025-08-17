import { useEffect, useRef, useState } from 'react';

/**
 * コンテナ要素の幅を監視し、リアルタイムで更新するカスタムフック
 *
 * PhotoGrid と MeasurePhotoGroup で重複していた ResizeObserver のロジックを
 * 共通化し、コンテナ幅の変更を効率的に監視する。
 *
 * ## 使用例
 * ```typescript
 * const { containerRef, containerWidth } = useContainerWidth();
 *
 * return (
 *   <div ref={containerRef}>
 *     {containerWidth > 0 && <PhotoGrid width={containerWidth} />}
 *   </div>
 * );
 * ```
 *
 * ## 最適化
 * - デバウンス処理によりリサイズイベントの頻度を制限
 * - クリーンアップ処理でメモリリークを防止
 * - 初期値0で未測定状態を明確化
 *
 * @param debounceMs - リサイズイベントのデバウンス時間（ミリ秒）
 * @returns containerRef - 監視対象のコンテナ要素に設定するref
 * @returns containerWidth - 現在のコンテナ幅（px）
 */
export function useContainerWidth(debounceMs = 100) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!containerRef.current) return;

    const handleResize = () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = window.setTimeout(() => {
        if (containerRef.current) {
          setContainerWidth(containerRef.current.clientWidth);
        }
      }, debounceMs);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    // 初期値を設定
    setContainerWidth(containerRef.current.clientWidth);

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
      resizeObserver.disconnect();
    };
  }, [debounceMs]);

  return { containerRef, containerWidth };
}
