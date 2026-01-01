import { useCallback, useEffect, useRef, useState } from 'react';
import { toValidWidth, type ValidWidth } from '../types/validWidth';

/**
 * 幅測定の状態を明示的に表現
 *
 * - `measuring`: 幅を測定中（DOM がまだ確定していない可能性）
 * - `ready`: 幅が確定（レンダリング可能）
 */
export type WidthState =
  | { status: 'measuring' }
  | { status: 'ready'; width: ValidWidth };

/** デバッグログを有効にするかどうか（本番調査用） */
const DEBUG_WIDTH_MEASUREMENT = true;

/**
 * コンテナ幅を測定するカスタムフック（Callback Ref パターン）
 *
 * ## 設計原則
 *
 * 1. **Callback Ref を使用**: ref が attach された瞬間に確実にコールバックが呼ばれる
 * 2. **明示的な状態管理**: "測定中" と "準備完了" を区別
 * 3. **型安全**: ValidWidth 型で 0 以下を型レベルで排除
 *
 * ## なぜ Callback Ref か
 *
 * `useLayoutEffect` + `RefObject` パターンでは、初回レンダリング時に
 * `containerRef.current` が `null` の場合、effect が早期リターンし、
 * その後 ref が有効になっても effect が再実行されない問題があった。
 *
 * Callback Ref は DOM に要素が attach された瞬間に呼ばれるため、
 * このタイミング問題を根本的に解決できる。
 *
 * ## 使用例
 *
 * ```tsx
 * const { containerRef, widthState } = useContainerWidth(32);
 *
 * return (
 *   <div ref={containerRef}>
 *     {match(widthState)
 *       .with({ status: 'measuring' }, () => <Skeleton />)
 *       .with({ status: 'ready' }, ({ width }) => <Content width={width} />)
 *       .exhaustive()}
 *   </div>
 * );
 * ```
 *
 * @param padding - コンテナのパディング（幅から減算される）
 * @returns containerRef（callback ref）と widthState
 */
export function useContainerWidth(padding = 0): {
  containerRef: (node: HTMLElement | null) => void;
  widthState: WidthState;
} {
  const [state, setState] = useState<WidthState>({ status: 'measuring' });
  const observerRef = useRef<ResizeObserver | null>(null);
  const nodeRef = useRef<HTMLElement | null>(null);

  // padding を ref で保持（callback ref の依存を減らすため）
  const paddingRef = useRef(padding);
  paddingRef.current = padding;

  const containerRef = useCallback((node: HTMLElement | null) => {
    if (DEBUG_WIDTH_MEASUREMENT) {
      console.log('[useContainerWidth] Callback ref called:', {
        nodeExists: !!node,
        nodeTagName: node?.tagName,
        timestamp: performance.now().toFixed(2),
      });
    }

    // 古い observer をクリーンアップ
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    nodeRef.current = node;

    if (!node) {
      if (DEBUG_WIDTH_MEASUREMENT) {
        console.log(
          '[useContainerWidth] Node detached, resetting to measuring',
        );
      }
      setState({ status: 'measuring' });
      return;
    }

    const measureWidth = () => {
      const rawWidth = node.clientWidth;
      const adjustedWidth = rawWidth - paddingRef.current;
      const validWidth = toValidWidth(adjustedWidth);

      if (DEBUG_WIDTH_MEASUREMENT) {
        console.log('[useContainerWidth] Measuring:', {
          rawWidth,
          adjustedWidth,
          isValid: validWidth !== null,
          timestamp: performance.now().toFixed(2),
        });
      }

      if (validWidth !== null) {
        if (DEBUG_WIDTH_MEASUREMENT) {
          console.log(
            '[useContainerWidth] ✅ Width measured successfully:',
            adjustedWidth,
          );
        }
        setState({ status: 'ready', width: validWidth });
      } else {
        // 幅が 0 以下の場合は measuring 状態を維持
        // ResizeObserver がサイズ変更を検知したら再測定される
        if (DEBUG_WIDTH_MEASUREMENT) {
          console.log(
            '[useContainerWidth] ⚠️ Invalid width, waiting for resize...',
          );
        }
      }
    };

    // ResizeObserver で継続的に監視
    observerRef.current = new ResizeObserver(() => {
      measureWidth();
    });
    observerRef.current.observe(node);

    // 初期測定
    measureWidth();
  }, []);

  // アンマウント時のクリーンアップ
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);

  return { containerRef, widthState: state };
}
