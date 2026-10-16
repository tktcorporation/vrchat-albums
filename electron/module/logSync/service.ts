import { Cause, Effect, Exit } from 'effect';
import { match } from 'ts-pattern';

import { logger } from '../../lib/logger';
import {
  beginInitProgressRun,
  emitStageProgress,
  endInitProgressRun,
} from '../initProgress/emitter';
import type { InitLaunch } from '../initProgress/schema';
import type { LogInfoError } from '../logInfo/error';
import type { LogInfoServiceError } from '../logInfo/errors';
import { loadLogInfoIndexFromVRChatLog } from '../logInfo/service';
import { getSettingStore } from '../settingStore';
import { VRChatLogFileError } from '../vrchatLog/error';
import type { VRChatLogError } from '../vrchatLog/errors';
import type { AppendLoglinesResult } from '../vrchatLog/vrchatLogController';
import { appendLoglinesToFileFromLogFilePathList } from '../vrchatLog/vrchatLogController';
import type { VRChatPhotoPathModel } from '../vrchatPhoto/model/vrchatPhotoPath.model';
import { getVRChatPhotoDirPath } from '../vrchatPhoto/vrchatPhoto.service';
import type { VRChatPlayerJoinLogModel } from '../VRChatPlayerJoinLogModel/playerJoinInfoLog.model';
import type { VRChatPlayerLeaveLogModel } from '../VRChatPlayerLeaveLogModel/playerLeaveLog.model';
import type { VRChatWorldJoinLogModel } from '../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';
import { generateMissingWorldJoinImages } from '../worldJoinImage/service';

interface LogSyncResults {
  createdWorldJoinLogModelList: VRChatWorldJoinLogModel[];
  createdPlayerJoinLogModelList: VRChatPlayerJoinLogModel[];
  createdPlayerLeaveLogModelList: VRChatPlayerLeaveLogModel[];
  createdVRChatPhotoPathModelList: VRChatPhotoPathModel[];
}

/**
 * ログ同期のモード定義
 */
export const LOG_SYNC_MODE = {
  /**
   * 全件処理モード
   * - 初回起動時
   * - 設定画面からの手動更新時
   */
  FULL: 'FULL',
  /**
   * 差分処理モード
   * - 通常の更新時
   * - バックグラウンド更新時
   */
  INCREMENTAL: 'INCREMENTAL',
} as const;

export type LogSyncMode = (typeof LOG_SYNC_MODE)[keyof typeof LOG_SYNC_MODE];

/**
 * ログ同期モードを進捗ストリームの起動種別の表記に変換する。
 */
export const toInitSyncMode = (mode: LogSyncMode): InitLaunch['syncMode'] =>
  match(mode)
    .with(LOG_SYNC_MODE.FULL, () => 'full' as const)
    .with(LOG_SYNC_MODE.INCREMENTAL, () => 'incremental' as const)
    .exhaustive();

/**
 * ログ同期の並行実行を直列化するセマフォ (permit=1)。
 *
 * logSyncController の定期バックグラウンド同期と、ユーザー操作による FULL/INCREMENTAL 同期が
 * 同時に走ると、appendLoglines → loadLogInfo の順序前提が崩れ、DB 二重書き込みやキャッシュ不整合を
 * 招く (ADR-001)。モジュールスコープで単一インスタンスを保持し、全ての syncLogs 呼び出しを直列化する。
 * 進捗ストリームの実行（initProgress/emitter.ts）も permit を持っている間に開始・終了するので、
 * 単独の同期が起動時の初期化の実行を置き換えたり閉じたりすることは無い。
 *
 * 生の boolean フラグ（共有可変状態）ではなく Semaphore を使う理由:
 * withPermits は Effect の完了時（成功・失敗・中断のいずれでも）permit を必ず解放するため、
 * フラグの戻し忘れやエラー経路での取りこぼしによるデッドロックが構造的に起きない。
 */
const syncMutex = Effect.runSync(Effect.makeSemaphore(1));

/**
 * syncMutex の permit を持っていることを示す値。runWithLogSyncLock だけが作れるので、
 * これを要求する関数は permit を持たない呼び出し元から呼べない。
 * permit は再入できないため、permit を持ったまま syncLogs を呼ぶと待ち続けてしまう。
 * その場合は syncLogsHoldingLock を使う。
 */
class LogSyncLockToken {
  /** private メンバーを持たせて構造的に同じ形の値と区別する（実行時には存在しない） */
  declare private readonly brand: never;
}
export type LogSyncLock = LogSyncLockToken;

type SyncLogsError =
  | VRChatLogFileError
  | VRChatLogError
  | LogInfoError
  | LogInfoServiceError;

/**
 * ログの同期処理を統一的に実行するサービス
 *
 * このサービスは以下の処理を順番に実行します：
 * 1. appendLoglines: VRChatのログファイルから新しいログ行を抽出し、アプリ内のログストアに保存
 * 2. loadLogInfo: 保存されたログをデータベースに読み込む
 *
 * 並行呼び出しは syncMutex により直列化され、同時実行による順序崩れを防ぐ。
 * 単独の同期として進捗ストリームの実行を permit の内側で開始・終了する。
 *
 * @param mode 同期モード (FULL: 全件処理, INCREMENTAL: 差分処理)
 * @returns 処理結果（作成されたログ情報を含む）
 */
export function syncLogs(
  mode: LogSyncMode,
): Effect.Effect<LogSyncResults, SyncLogsError> {
  return syncMutex.withPermits(1)(withOwnInitProgressRun(mode, runSync(mode)));
}

/**
 * permit を既に持っている呼び出し元（起動時の初期化）からログ同期を行う。
 * 進捗ストリームの実行は呼び出し元が持っているので、開始も終了もしない。
 *
 * @param _lock runWithLogSyncLock から受け取った値。permit を持っていることの証明にだけ使う
 */
export function syncLogsHoldingLock(
  _lock: LogSyncLock,
  mode: LogSyncMode,
): Effect.Effect<LogSyncResults, SyncLogsError> {
  return runSync(mode);
}

/**
 * syncMutex の permit を取ってから task を実行し、完了（成功・失敗とも）で permit を返す。
 * 起動時の初期化が、進捗ストリームの実行の開始から終了までを単独の同期と重ならないようにするために使う。
 * task の reject はそのまま呼び出し元へ伝える。
 */
export const runWithLogSyncLock = async <T>(
  task: (lock: LogSyncLock) => Promise<T>,
): Promise<T> => {
  const exit = await Effect.runPromiseExit(
    syncMutex.withPermits(1)(
      Effect.promise(() => task(new LogSyncLockToken())),
    ),
  );
  return Exit.match(exit, {
    onSuccess: (value) => value,
    onFailure: (cause) => {
      throw Cause.squash(cause);
    },
  });
};

/**
 * appendLoglines → loadLogInfo を順に実行する本体。permit の取得は呼び出し側が行う。
 */
const runSync = (
  mode: LogSyncMode,
): Effect.Effect<LogSyncResults, SyncLogsError> =>
  Effect.gen(function* () {
    const isFullSync = mode === LOG_SYNC_MODE.FULL;

    logger.info(`Starting log sync with mode: ${mode}`);

    // Step 1: VRChatログファイルから新しいログ行を抽出・保存
    // ファイル単位の進捗は appendLoglinesToFileFromLogFilePathList 内で送られる
    emitStageProgress('log_append', 0);
    const appendResult: AppendLoglinesResult = yield* Effect.tryPromise({
      try: () => appendLoglinesToFileFromLogFilePathList(isFullSync),
      catch: (error) => {
        logger.error({
          message: 'Failed to append log lines',
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
        if (error instanceof VRChatLogFileError) {
          return error;
        }
        return new VRChatLogFileError({
          code: 'UNKNOWN',
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
    emitStageProgress('log_append', 100);

    // Step 2: 保存されたログをデータベースに読み込む
    // INCREMENTAL モードでは step1 で処理済みのログ行を直接渡し、
    // logStore ファイルの再読み込みをスキップする
    // log_load 以降（写真インデックスまで）の進捗は loadLogInfoIndexFromVRChatLog 内で送られる
    const loadResult = yield* loadLogInfoIndexFromVRChatLog({
      excludeOldLogLoad: !isFullSync,
      preLoadedLogLines: isFullSync
        ? undefined
        : appendResult.processedLogLines,
    });

    logger.info(`Log sync completed successfully with mode: ${mode}`);

    // Fire-and-forget: ワールド参加画像の自動生成（syncLogs の結果をブロックしない）
    triggerWorldJoinImageGeneration();

    return loadResult;
  });

/**
 * 単独のログ同期（手動更新・バックグラウンド同期など）の進捗ストリームの実行を開始・終了する。
 * syncMutex の permit の内側で呼ぶので、他の実行と重ならない。
 * 種類は `sync` なので、起動画面はこの実行を表示せず、統計の集計も行われない。
 */
const withOwnInitProgressRun = <A, E>(
  mode: LogSyncMode,
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.suspend(() => {
    const runId = beginInitProgressRun('sync', {
      syncMode: toInitSyncMode(mode),
      isFirstLaunch: false,
    });
    return effect.pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          endInitProgressRun(
            runId,
            exit._tag === 'Success' ? 'completed' : 'error',
          );
        }),
      ),
    );
  });

/**
 * 設定が有効な場合、未生成の World Join 画像を生成する
 *
 * 背景: syncLogs 完了後に非同期で実行される。
 * syncLogs の結果には影響しないため fire-and-forget で呼び出す。
 * エラーはログに記録するのみ（Sentry 経由で検知可能）。
 */
function triggerWorldJoinImageGeneration(): void {
  // effect-lint-allow-try-catch: getSettingStore() が初期化前に呼ばれた場合のエラーハンドリング
  try {
    const settingStore = getSettingStore();
    if (!settingStore.getWorldJoinImageGenerationEnabled()) {
      return;
    }

    // settingStore.getVRChatPhotoDir() はユーザー未設定時に null を返すが、
    // getVRChatPhotoDirPath() はデフォルトパス（~/Pictures/VRChat）にフォールバックする。
    // 写真閲覧と同じデフォルトパスを使うことで、初期設定のままでも画像生成が動作する。
    const photoDirPath = getVRChatPhotoDirPath().value;

    void Effect.runPromise(
      generateMissingWorldJoinImages({ photoDirPath }),
    ).catch((error) => {
      logger.error({
        message: 'Failed to generate world join images',
        stack: error instanceof Error ? error : new Error(String(error)),
      });
    });
  } catch (error) {
    // getSettingStore() が初期化前に呼ばれた場合など
    logger.error({
      message: 'Failed to trigger world join image generation',
      stack: error instanceof Error ? error : new Error(String(error)),
    });
  }
}

/**
 * バックグラウンド処理用のログ同期
 * 差分処理モードで実行される
 */
export function syncLogsInBackground(): Effect.Effect<
  LogSyncResults,
  SyncLogsError
> {
  return syncLogs(LOG_SYNC_MODE.INCREMENTAL);
}
