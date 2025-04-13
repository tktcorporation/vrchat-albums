import { invalidatePhotoGalleryQueries } from '@/queryClient';
import { trpcReact } from '@/trpc';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { match } from 'ts-pattern';

type ProcessStage = 'pending' | 'inProgress' | 'success' | 'error' | 'skipped';

export interface ProcessStages {
  /**
   * データベースの同期開始状態を追跡
   * - pending: 同期開始待ち
   * - inProgress: 同期開始中
   * - success: 同期開始成功
   * - error: 同期開始失敗
   * - skipped: 同期不要のためスキップ
   */
  startingSync: ProcessStage;

  /**
   * データベースの同期完了状態を追跡
   * - pending: 同期完了待ち
   * - inProgress: 同期実行中
   * - success: 同期完了
   * - error: 同期失敗
   * - skipped: 同期不要のためスキップ
   */
  syncDone: ProcessStage;

  /**
   * VRChatログファイルの保存状態を追跡
   * - pending: ログ保存待ち
   * - inProgress: ログ保存中
   * - success: ログ保存完了
   * - error: ログ保存失敗
   * - skipped: ログ保存不要のためスキップ
   */
  logsStored: ProcessStage;

  /**
   * ログ情報インデックスの読み込み状態を追跡
   * - pending: インデックス読み込み待ち
   * - inProgress: インデックス読み込み中
   * - success: インデックス読み込み完了
   * - error: インデックス読み込み失敗
   * - skipped: インデックス読み込み不要のためスキップ
   */
  indexLoaded: ProcessStage;
}

export interface ProcessError {
  stage: keyof ProcessStages;
  message: string;
}

const initialStages: ProcessStages = {
  startingSync: 'pending',
  syncDone: 'pending',
  logsStored: 'pending',
  indexLoaded: 'pending',
};

interface ProcessStageCallbacks {
  onError?: (error: ProcessError) => void;
  onComplete?: () => void;
}

/**
 * アプリケーション起動時の各種処理ステージを管理するフック
 *
 * 重要な処理フロー:
 * 1. データベース同期（startingSync → syncDone）
 * 2. VRChatログファイルの処理（logsStored）
 * 3. ログ情報のインデックス化（indexLoaded）
 *
 * この順序は厳守する必要があります:
 * - ログファイル処理→インデックス化の順序が入れ替わると、新しいログが正しく処理されません
 * - リフレッシュ処理（Header.tsx の handleRefresh）と同じ順序で処理する必要があります
 */
export const useStartupStage = (callbacks?: ProcessStageCallbacks) => {
  const [stages, setStages] = useState<ProcessStages>(initialStages);
  const [error, setError] = useState<ProcessError | null>(null);
  const [hasNotifiedCompletion, setHasNotifiedCompletion] = useState(false);

  const updateStage = useCallback(
    (stage: keyof ProcessStages, status: ProcessStage, errorMsg?: string) => {
      setStages((prev) => ({ ...prev, [stage]: status }));

      console.log({
        event: 'updateStage',
        stage,
        status,
        errorMessage: errorMsg,
      });

      if (status === 'error' && errorMsg) {
        const processError = { stage, message: errorMsg };
        setError(processError);
        callbacks?.onError?.(processError);
      } else if (status === 'success' || status === 'skipped') {
        setError(null);
      }
    },
    [callbacks],
  );

  const { data: migrateRequirement, refetch: refetchMigrateRequirement } =
    trpcReact.settings.isDatabaseReady.useQuery(undefined, {
      onSuccess: (data: boolean) => {
        console.log('isDatabaseReady query succeeded:', { data });
      },
      onError: () => {
        console.error('isDatabaseReady query failed');
      },
    });

  const syncRdbMutation = trpcReact.settings.syncDatabase.useMutation({
    retry: 3,
    retryDelay: 3000,
    onMutate: () => {
      console.log('Starting database sync mutation');
      updateStage('startingSync', 'inProgress');
    },
    onSuccess: () => {
      console.log('Database sync succeeded');
      updateStage('startingSync', 'success');
      updateStage('syncDone', 'success');
      executeLogOperations();
    },
    onError: (error) => {
      console.error('Database sync failed:', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'データベース同期に失敗しました';
      updateStage('startingSync', 'error');
      updateStage('syncDone', 'error', errorMessage);
    },
  });

  const { data: logFilesDirData } = trpcReact.getVRChatLogFilesDir.useQuery();
  const utils = trpcReact.useUtils();

  /**
   * VRChatのログ情報をデータベースにロードするミューテーション
   *
   * 重要: このミューテーションは storeLogsMutation の後に実行する必要があります
   * - storeLogsMutation により、VRChatのログファイルから抽出されたログ行がアプリ内に保存されます
   * - excludeOldLogLoad: true を指定すると、最新のログのみが処理されます
   * - 最新のログのみを処理することで、パフォーマンスが向上します
   *
   * 成功するとPhotogalleryのクエリキャッシュが無効化され、UIが更新されます
   */
  const loadLogInfoIndexMutation =
    trpcReact.logInfo.loadLogInfoIndex.useMutation({
      onMutate: (input) => {
        console.log('Starting loadLogInfoIndex', { input });
        updateStage('indexLoaded', 'inProgress');
      },
      onSuccess: () => {
        console.log('loadLogInfoIndex succeeded');
        updateStage('indexLoaded', 'success');
        invalidatePhotoGalleryQueries(utils);
      },
      onError: (error) => {
        console.error('loadLogInfoIndex failed:', error);
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'インデックスの読み込みに失敗しました';
        updateStage('indexLoaded', 'error', errorMessage);
      },
      onSettled: () => {
        console.log('loadLogInfoIndex settled');
      },
    });

  /**
   * VRChatログファイルから新しいログ行を読み込むミューテーション
   *
   * 重要な機能:
   * - VRChatのログファイル（output_log.txt）から関連するログ行を抽出します
   * - 抽出したログ行はアプリ内のログストアファイル（logStore-YYYY-MM.txt）に保存されます
   * - このプロセスがなければ、新しいワールド参加ログが検出されません
   *
   * 成功した場合のみ次のステップ（loadLogInfoIndexMutation）が実行されます
   * リフレッシュ処理（Header.tsx の handleRefresh）でも同様のプロセスが実行されます
   */
  const storeLogsMutation =
    trpcReact.vrchatLog.appendLoglinesToFileFromLogFilePathList.useMutation({
      onMutate: () => {
        console.log('Starting storeLogsMutation');
        updateStage('logsStored', 'inProgress');
      },
      onSuccess: () => {
        console.log('storeLogsMutation succeeded');
        updateStage('logsStored', 'success');
        loadLogInfoIndexMutation.mutate({ excludeOldLogLoad: true });
      },
      onError: (error) => {
        console.error('storeLogsMutation failed:', error);
        const errorMessage =
          error instanceof Error ? error.message : 'ログの保存に失敗しました';
        updateStage('logsStored', 'error', errorMessage);
      },
      onSettled: () => {
        console.log('storeLogsMutation settled');
      },
    });

  /**
   * ログ処理オペレーションを実行する関数
   *
   * 処理フロー:
   * 1. storeLogsMutation: VRChatログファイルからログ行を抽出してアプリ内に保存
   * 2. loadLogInfoIndexMutation: 保存されたログからログ情報をロードしてDBに保存
   * 3. invalidatePhotoGalleryQueries: UIを更新
   *
   * この順序が重要な理由:
   * - 1→2→3の順で処理しないと、新しいワールド参加ログがDBに保存されず、
   *   新しい写真が古いワールドグループに誤って割り当てられます
   */
  const executeLogOperations = useCallback(() => {
    console.log('executeLogOperations called', { logFilesDirData, stages });

    if (stages.logsStored !== 'pending') {
      console.log('Log operations already started or completed');
      return;
    }

    if (!logFilesDirData) {
      console.log('logFilesDirData is not available');
      return;
    }

    if (logFilesDirData.error) {
      console.log('logFilesDirData has error:', logFilesDirData.error);
      const message = match(logFilesDirData.error)
        .with('logFilesNotFound', () => 'ログファイルが見つかりませんでした')
        .with('logFileDirNotFound', () => 'フォルダの読み取りに失敗しました')
        .otherwise(() => '不明なエラーが発生しました');

      updateStage('logsStored', 'error', message);
      return;
    }

    try {
      if (stages.logsStored !== 'pending') {
        console.log('Log operations was started by another call');
        return;
      }
      console.log('Starting store logs mutation');
      storeLogsMutation.mutate();
    } catch (error) {
      console.error('Error during store logs mutation:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'ログの保存に失敗しました';
      updateStage('logsStored', 'error', errorMessage);
    }
  }, [logFilesDirData, stages, storeLogsMutation, updateStage]);

  const retryProcess = useCallback(() => {
    setStages(initialStages);
    setError(null);
    setHasNotifiedCompletion(false);
    refetchMigrateRequirement();
  }, [refetchMigrateRequirement]);

  useEffect(() => {
    if (migrateRequirement === undefined) {
      console.log('migrateRequirement is undefined');
      return;
    }

    console.log('Migration requirement check:', {
      migrateRequirement,
      stages: JSON.stringify(stages),
    });

    if (migrateRequirement) {
      if (stages.startingSync !== 'pending') {
        console.log('Database sync already started or completed');
        return;
      }

      console.log('Starting database sync');

      const timeoutId = setTimeout(() => {
        console.error('Database sync timeout');
        updateStage('startingSync', 'error');
        updateStage(
          'syncDone',
          'error',
          'データベース同期がタイムアウトしました',
        );
      }, 30000);

      try {
        syncRdbMutation.mutate(undefined, {
          onSuccess: () => {
            clearTimeout(timeoutId);
          },
          onError: () => {
            clearTimeout(timeoutId);
          },
          onSettled: () => {
            console.log('Database sync settled');
          },
        });
      } catch (error) {
        console.error('Error during sync mutation:', error);
        clearTimeout(timeoutId);
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'データベース同期の開始に失敗しました';
        updateStage('startingSync', 'error');
        updateStage('syncDone', 'error', errorMessage);
      }

      return () => {
        clearTimeout(timeoutId);
      };
    }
    console.log('Skipping database sync');
    updateStage('startingSync', 'skipped');
    updateStage('syncDone', 'skipped');
    executeLogOperations();
  }, [migrateRequirement, stages.startingSync]);

  const completed = useMemo(
    () =>
      Object.values(stages).every(
        (stage) => stage === 'success' || stage === 'skipped',
      ),
    [stages],
  );

  useEffect(() => {
    if (completed && !hasNotifiedCompletion) {
      setHasNotifiedCompletion(true);
      callbacks?.onComplete?.();
    }
  }, [completed, hasNotifiedCompletion, callbacks]);

  const finished = useMemo(
    () =>
      Object.values(stages).every(
        (stage) =>
          stage === 'success' || stage === 'skipped' || stage === 'error',
      ),
    [stages],
  );

  useEffect(() => {
    console.log('Current stages:', JSON.stringify(stages, null, 2));
  }, [stages]);

  return {
    stages,
    updateStage,
    errorMessage: error?.message ?? '',
    errorStage: error?.stage ?? '',
    retryProcess,
    completed,
    finished,
  };
};
