import { useCallback, useMemo, useState } from 'react';

interface LoadingState {
  /** 写真のグルーピング処理（ワールド情報との紐付けなど）が進行中かどうかを示します。 */
  isLoadingGrouping: boolean;
  /** ユーザーによる手動リフレッシュ処理が進行中かどうかを示します。 */
  isRefreshing: boolean;
}

interface LoadingActions {
  /** 写真のグルーピング処理の開始をマークします。 */
  startLoadingGrouping: () => void;
  /** 写真のグルーピング処理の完了をマークします。 */
  finishLoadingGrouping: () => void;
  /** 手動リフレッシュ処理の開始をマークします。 */
  startRefreshing: () => void;
  /** 手動リフレッシュ処理の完了をマークします。 */
  finishRefreshing: () => void;
}

export type UseLoadingStateResult = LoadingState & LoadingActions;

/**
 * アプリケーション全体の主要なローディング状態を一元管理するカスタムフックです。
 *
 * このフックは以下のローディング状態を提供・管理します：
 * - `isLoadingGrouping`: 写真データをワールド情報と紐付けるグルーピング処理の状態。
 * - `isRefreshing`: ユーザーが手動でデータ更新（リフレッシュ）操作を行った際の処理状態。
 *
 * これにより、異なるコンポーネント間でローディング状態を整合性を持って扱うことが容易になります。
 */
export const useLoadingState = (): UseLoadingStateResult => {
  const [isLoadingGrouping, setIsLoadingGrouping] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startLoadingGrouping = useCallback(
    () => setIsLoadingGrouping(true),
    [],
  );
  const finishLoadingGrouping = useCallback(
    () => setIsLoadingGrouping(false),
    [],
  );
  const startRefreshing = useCallback(() => setIsRefreshing(true), []);
  const finishRefreshing = useCallback(() => setIsRefreshing(false), []);

  // 返り値オブジェクトをメモ化して、参照の安定性を確保
  // これにより、依存配列に含めた際の不要な再レンダリングを防ぐ
  return useMemo(
    () => ({
      isLoadingGrouping,
      isRefreshing,
      startLoadingGrouping,
      finishLoadingGrouping,
      startRefreshing,
      finishRefreshing,
    }),
    [
      isLoadingGrouping,
      isRefreshing,
      startLoadingGrouping,
      finishLoadingGrouping,
      startRefreshing,
      finishRefreshing,
    ],
  );
};
