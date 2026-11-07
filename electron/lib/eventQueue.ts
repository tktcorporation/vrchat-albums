/**
 * EventEmitter のイベントを、tRPC の subscription（非同期ジェネレーター）から
 * 1 件ずつ yield するためのキュー。
 *
 * push() でイベントの値を溜め、drain() が溜まった値を順に yield する。キューが空の間は
 * 次の push() を待つ。
 *
 * drain() は `signal` の中止でも待ちを抜けて終わる。購読を止めるとき tRPC は signal を
 * 中止して return() を呼ぶが、非同期ジェネレーターは await の途中にいると return() を
 * 次の yield まで受け付けない。中止で待ちを抜けないと、次のイベントが来るまで
 * `finally` のリスナー解除が走らず、画面の再読み込みのたびにリスナーが積み上がる。
 */
export const createEventQueue = <T>(signal: AbortSignal | undefined) => {
  const queue: T[] = [];
  let wake: (() => void) | null = null;

  const waitForPushOrAbort = () =>
    new Promise<void>((resolve) => {
      const onAbort = () => resolve();
      signal?.addEventListener('abort', onAbort, { once: true });
      wake = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
    });

  return {
    push(item: T) {
      queue.push(item);
      const pending = wake;
      wake = null;
      pending?.();
    },
    /**
     * `signal` が中止されるまで、届いた値を順に返し続ける。
     *
     * @yields push() された値を届いた順に返す
     */
    async *drain(): AsyncGenerator<T, void> {
      while (!signal?.aborted) {
        if (queue.length === 0) {
          await waitForPushOrAbort();
          continue;
        }
        // 直前で空でないことを確かめているので、shift() は push() された値を返す
        yield queue.shift() as T;
      }
    },
  };
};
