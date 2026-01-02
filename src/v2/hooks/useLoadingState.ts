import { useCallback, useMemo, useState } from 'react';

interface LoadingState {
  /** アプリ起動時の同期処理（ログ読み込み、インデックス構築など）が進行中かどうかを示します。 */
  isLoadingStartupSync: boolean;
  /** 写真のグルーピング処理（ワールド情報との紐付けなど）が進行中かどうかを示します。 */
  isLoadingGrouping: boolean;
  /** ユーザーによる手動リフレッシュ処理が進行中かどうかを示します。 */
  isRefreshing: boolean;
}

interface LoadingActions {
  /** アプリ起動時の同期処理の開始をマークします。 */
  startLoadingStartupSync: () => void;
  /** アプリ起動時の同期処理の完了をマークします。 */
  finishLoadingStartupSync: () => void;
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
 * - `isLoadingStartupSync`: アプリ起動時の初期データ同期処理（ログファイルの読み込み、データベースのインデックス構築など）の状態。
 * - `isLoadingGrouping`: 写真データをワールド情報と紐付けるグルーピング処理の状態。
 * - `isRefreshing`: ユーザーが手動でデータ更新（リフレッシュ）操作を行った際の処理状態。
 *
 * これにより、異なるコンポーネント間でローディング状態を整合性を持って扱うことが容易になります。
 */
export const useLoadingState = (): UseLoadingStateResult => {
  const [isLoadingStartupSync, setIsLoadingStartupSync] = useState(false);
  const [isLoadingGrouping, setIsLoadingGrouping] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startLoadingStartupSync = useCallback(
    () => setIsLoadingStartupSync(true),
    [],
  );
  const finishLoadingStartupSync = useCallback(
    () => setIsLoadingStartupSync(false),
    [],
  );
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
      isLoadingStartupSync,
      isLoadingGrouping,
      isRefreshing,
      startLoadingStartupSync,
      finishLoadingStartupSync,
      startLoadingGrouping,
      finishLoadingGrouping,
      startRefreshing,
      finishRefreshing,
    }),
    [
      isLoadingStartupSync,
      isLoadingGrouping,
      isRefreshing,
      startLoadingStartupSync,
      finishLoadingStartupSync,
      startLoadingGrouping,
      finishLoadingGrouping,
      startRefreshing,
      finishRefreshing,
    ],
  );
};
