import { type RefObject, useLayoutEffect, useRef, useState } from 'react';
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

/**
 * コンテナ幅を測定するカスタムフック
 *
 * ## 設計原則
 *
 * 1. **useLayoutEffect を使用**: ペイント前に同期実行
 * 2. **明示的な状態管理**: "測定中" と "準備完了" を区別
 * 3. **型安全**: ValidWidth 型で 0 以下を型レベルで排除
 *
 * ## Electron 対応
 *
 * - 起動直後は DOM が確定していない可能性がある
 * - ResizeObserver で継続的に監視
 * - 最大 10 回まで測定をリトライ
 *
 * ## 使用例
 *
 * ```tsx
 * const widthState = useContainerWidth(containerRef, 32);
 *
 * {match(widthState)
 *   .with({ status: 'measuring' }, () => <Skeleton />)
 *   .with({ status: 'ready' }, ({ width }) => <Content width={width} />)
 *   .exhaustive()}
 * ```
 *
 * @param containerRef - コンテナ要素への ref
 * @param padding - コンテナのパディング（幅から減算される）
 * @returns 幅の状態（measuring または ready）
 */
export function useContainerWidth(
  containerRef: RefObject<HTMLElement | null>,
  padding = 0,
): WidthState {
  const [state, setState] = useState<WidthState>({ status: 'measuring' });
  const retryCountRef = useRef(0);

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const MAX_RETRIES = 10;
    const RETRY_DELAY = 50; // ms
    let timeoutId: number | undefined;
    let animationFrameId: number | undefined;

    const measureWidth = () => {
      const rawWidth = containerRef.current?.clientWidth ?? 0;
      const adjustedWidth = rawWidth - padding;
      const validWidth = toValidWidth(adjustedWidth);

      if (validWidth !== null) {
        setState({ status: 'ready', width: validWidth });
        retryCountRef.current = MAX_RETRIES; // リトライを停止
      } else if (retryCountRef.current < MAX_RETRIES) {
        // 幅が 0 の場合、次のフレームで再測定をスケジュール
        retryCountRef.current++;
        timeoutId = window.setTimeout(() => {
          animationFrameId = requestAnimationFrame(measureWidth);
        }, RETRY_DELAY);
      }
      // MAX_RETRIES 到達時は measuring のまま（ログ出力推奨）
    };

    const observer = new ResizeObserver(() => {
      // サイズ変更時は常に再測定
      const rawWidth = containerRef.current?.clientWidth ?? 0;
      const adjustedWidth = rawWidth - padding;
      const validWidth = toValidWidth(adjustedWidth);

      if (validWidth !== null) {
        setState({ status: 'ready', width: validWidth });
      }
    });

    observer.observe(containerRef.current);
    measureWidth(); // 初期測定

    return () => {
      observer.disconnect();
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (animationFrameId !== undefined)
        cancelAnimationFrame(animationFrameId);
    };
  }, [containerRef, padding]);

  return state;
}
