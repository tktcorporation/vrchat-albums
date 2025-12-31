import * as neverthrow from 'neverthrow';
import { match, P } from 'ts-pattern';
import z from 'zod';
import { BATCH_CONFIG } from '../../constants/batchConfig';
import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  UserFacingError,
} from '../../lib/errors';
import { logger } from './../../lib/logger';
import { playerListCache } from './../../lib/queryCache';
import { procedure, router as trpcRouter } from './../../trpc';
import {
  type VRChatPhotoFileNameWithExt,
  VRChatPhotoFileNameWithExtSchema,
} from './../../valueObjects';
import * as playerJoinLogService from '../VRChatPlayerJoinLogModel/playerJoinLog.service';
import * as worldJoinLogService from '../vrchatWorldJoinLog/service';
import { findVRChatWorldJoinLogFromPhotoList } from '../vrchatWorldJoinLogFromPhoto/service';
import {
  getFrequentPlayerNames,
  getPlayerNameSuggestions,
  getWorldNameSuggestions,
  loadLogInfoIndexFromVRChatLog,
  searchSessionsByPlayerName,
} from './service';

/**
 * 統合されたワールド参加ログを取得・マージ・ソートする共通関数
 * @param searchParams - ログ検索パラメーター
 * @param sortOrder - ソート順序（'desc' = 降順、'asc' = 昇順）
 * @returns ソート済みの統合ログ配列
 */
const fetchAndMergeSortedWorldJoinLogs = async (
  searchParams: {
    ltJoinDateTime?: Date;
    gtJoinDateTime?: Date;
    orderByJoinDateTime: 'asc' | 'desc';
  },
  sortOrder: 'desc' | 'asc' = 'desc',
) => {
  // 通常ログとPhotoAsLogを並行取得
  const [normalLogs, photoLogs] = await Promise.all([
    worldJoinLogService.findVRChatWorldJoinLogList(searchParams),
    findVRChatWorldJoinLogFromPhotoList(searchParams),
  ]);

  logger.debug({
    message: 'World join logs retrieved',
    normalLogsCount: normalLogs.length,
    photoLogsCount: photoLogs.length,
  });

  // 統合してソート
  const mergedLogs = worldJoinLogService.mergeVRChatWorldJoinLogs({
    normalLogs: normalLogs,
    photoLogs: photoLogs,
  });

  // 指定された順序でソート
  const sortedLogs = mergedLogs.sort((a, b) =>
    sortOrder === 'desc'
      ? b.joinDateTime.getTime() - a.joinDateTime.getTime()
      : a.joinDateTime.getTime() - b.joinDateTime.getTime(),
  );

  return sortedLogs;
};

const getVRCWorldJoinLogList = async () => {
  const result = await worldJoinLogService.findAllVRChatWorldJoinLogList();
  if (result.isErr()) {
    throw UserFacingError.withStructuredInfo({
      code: ERROR_CODES.DATABASE_ERROR,
      category: ERROR_CATEGORIES.DATABASE_ERROR,
      message: `Failed to get world join log list: ${result.error.message}`,
      userMessage: 'ワールド参加ログの取得中にエラーが発生しました。',
      cause: new Error(result.error.message),
    });
  }
  return result.value.map((joinLog) => {
    return {
      id: joinLog.id as string,
      worldId: joinLog.worldId,
      worldName: joinLog.worldName,
      worldInstanceId: joinLog.worldInstanceId,
      joinDateTime: joinLog.joinDateTime,
      createdAt: joinLog.createdAt as Date,
      updatedAt: joinLog.updatedAt as Date,
    };
  });
};

/**
 * 統合されたワールド参加ログから指定日時以前の最新ログを取得
 * 通常ログを優先し、PhotoAsLogと統合した結果から検索
 * 指定時刻のログも含めるため、1秒後までの範囲で検索
 */
const findRecentMergedWorldJoinLog = async (datetime: Date) => {
  try {
    // 指定時刻から1秒後までのログを取得（指定時刻のログも含める）
    const searchEndTime = new Date(datetime.getTime() + 1000);

    logger.debug({
      message: 'Querying world join logs',
      operation: 'findRecentMergedWorldJoinLog',
      searchEndTime: searchEndTime.toISOString(),
    });

    // 共通関数を使用して統合・ソート済みログを取得
    const sortedLogs = await fetchAndMergeSortedWorldJoinLogs(
      {
        ltJoinDateTime: searchEndTime,
        orderByJoinDateTime: 'desc',
      },
      'desc',
    );

    return sortedLogs[0] ?? null;
  } catch (error) {
    logger.error({
      message: `Error in findRecentMergedWorldJoinLog for datetime ${datetime.toISOString()}: ${error}`,
      stack: match(error)
        .with(P.instanceOf(Error), (err) => err)
        .otherwise((err) => new Error(String(err))),
    });
    throw UserFacingError.withStructuredInfo({
      code: ERROR_CODES.DATABASE_ERROR,
      category: ERROR_CATEGORIES.DATABASE_ERROR,
      message: `Failed to find recent world join log: ${error}`,
      userMessage: 'ワールド参加ログの取得中にエラーが発生しました。',
      cause: match(error)
        .with(P.instanceOf(Error), (err) => err)
        .otherwise((err) => new Error(String(err))),
    });
  }
};

/**
 * 統合されたワールド参加ログから指定日時以降の次のログを取得
 */
const findNextMergedWorldJoinLog = async (datetime: Date) => {
  try {
    logger.debug({
      message: 'Querying next world join logs',
      operation: 'findNextMergedWorldJoinLog',
      startDateTime: datetime.toISOString(),
    });

    // 共通関数を使用して統合・ソート済みログを取得
    const sortedLogs = await fetchAndMergeSortedWorldJoinLogs(
      {
        gtJoinDateTime: datetime,
        orderByJoinDateTime: 'asc',
      },
      'asc',
    );

    return sortedLogs[0] ?? null;
  } catch (error) {
    logger.error({
      message: `Error in findNextMergedWorldJoinLog for datetime ${datetime.toISOString()}: ${error}`,
      stack: match(error)
        .with(P.instanceOf(Error), (err) => err)
        .otherwise((err) => new Error(String(err))),
    });
    throw UserFacingError.withStructuredInfo({
      code: ERROR_CODES.DATABASE_ERROR,
      category: ERROR_CATEGORIES.DATABASE_ERROR,
      message: `Failed to find next world join log: ${error}`,
      userMessage: 'ワールド参加ログの取得中にエラーが発生しました。',
      cause: match(error)
        .with(P.instanceOf(Error), (err) => err)
        .otherwise((err) => new Error(String(err))),
    });
  }
};

const getRecentVRChatWorldJoinLogByVRChatPhotoName = async (
  vrchatPhotoName: VRChatPhotoFileNameWithExt,
): Promise<
  neverthrow.Result<
    {
      id: string;
      worldId: string;
      worldName: string;
      worldInstanceId: string;
      joinDateTime: Date;
      createdAt: Date;
      updatedAt: Date;
      nextJoinLog: {
        id: string;
        worldId: string;
        worldName: string;
        worldInstanceId: string;
        joinDateTime: Date;
        createdAt: Date;
        updatedAt: Date;
      } | null;
    },
    'RECENT_JOIN_LOG_NOT_FOUND' | 'DATABASE_ERROR'
  >
> => {
  const joinLogResult = await worldJoinLogService.findRecentVRChatWorldJoinLog(
    vrchatPhotoName.photoTakenDateTime,
  );
  if (joinLogResult.isErr()) {
    logger.error({
      message: '直近のワールド参加ログ取得中にエラーが発生しました',
      stack: new Error(JSON.stringify(joinLogResult.error)),
    });
    return neverthrow.err('DATABASE_ERROR' as const);
  }
  const joinLog = joinLogResult.value;
  if (joinLog === null) {
    return neverthrow.err('RECENT_JOIN_LOG_NOT_FOUND' as const);
  }

  const nextJoinLogResult =
    await worldJoinLogService.findNextVRChatWorldJoinLog(joinLog.joinDateTime);
  if (nextJoinLogResult.isErr()) {
    logger.error({
      message: '次のワールド参加ログ取得中にエラーが発生しました',
      stack: new Error(JSON.stringify(nextJoinLogResult.error)),
    });
    return neverthrow.err('DATABASE_ERROR' as const);
  }
  const nextJoinLog = nextJoinLogResult.value;

  return neverthrow.ok({
    id: joinLog.id as string,
    worldId: joinLog.worldId,
    worldName: joinLog.worldName,
    worldInstanceId: joinLog.worldInstanceId,
    joinDateTime: joinLog.joinDateTime,
    createdAt: joinLog.createdAt as Date,
    updatedAt: joinLog.updatedAt as Date,
    nextJoinLog: match(nextJoinLog)
      .with(P.nullish, () => null)
      .with(P.nonNullable, (value) => {
        return {
          id: value.id as string,
          worldId: value.worldId,
          worldName: value.worldName,
          worldInstanceId: value.worldInstanceId,
          joinDateTime: value.joinDateTime,
          createdAt: value.createdAt as Date,
          updatedAt: value.updatedAt as Date,
        };
      })
      .exhaustive(),
  });
};

/**
 * 同じセッション内でjoinしたプレイヤー全員のリストを取得
 * 統合されたワールド参加ログ（通常ログ優先）を使用してセッション範囲を特定
 * セッション期間内にjoinしたプレイヤー全員を返す（途中でleaveしたプレイヤーも含む）
 * @param datetime 参加日時
 * @returns プレイヤーリスト（セッション期間内にjoinした全プレイヤー）
 */
export const getPlayerJoinListInSameWorld = async (
  datetime: Date,
): Promise<
  neverthrow.Result<
    {
      id: string;
      playerId: string | null;
      playerName: string;
      joinDateTime: Date;
      createdAt: Date;
      updatedAt: Date;
    }[],
    'RECENT_JOIN_LOG_NOT_FOUND'
  >
> => {
  // ワールド情報を先に取得してキャッシュキーに含める（データ整合性のため）
  const recentWorldJoin = await findRecentMergedWorldJoinLog(datetime);
  if (recentWorldJoin === null) {
    return neverthrow.err('RECENT_JOIN_LOG_NOT_FOUND' as const);
  }

  // ワールドコンテキストを含むキャッシュキーを生成
  // セッション開始時刻とワールド情報を含めることで、異なるワールド/セッションの混同を防ぐ
  const sessionStartTime = Math.floor(
    recentWorldJoin.joinDateTime.getTime() / 1000,
  );
  const cacheKey = `playerList:${sessionStartTime}:${recentWorldJoin.worldId}:${recentWorldJoin.worldInstanceId}`;

  // Note: 予期しないエラーは自動的に throw され Sentry に通知される
  return playerListCache.getOrFetch(cacheKey, async () => {
    return getPlayerJoinListInSameWorldCore(datetime, recentWorldJoin);
  });
};

/**
 * キャッシュなしのコア実装
 */
const getPlayerJoinListInSameWorldCore = async (
  datetime: Date,
  recentWorldJoin?: {
    id: string;
    worldId: string;
    worldName: string;
    worldInstanceId: string;
    joinDateTime: Date;
    createdAt: Date;
    updatedAt: Date | null;
  },
): Promise<
  neverthrow.Result<
    {
      id: string;
      playerId: string | null;
      playerName: string;
      joinDateTime: Date;
      createdAt: Date;
      updatedAt: Date;
    }[],
    'RECENT_JOIN_LOG_NOT_FOUND'
  >
> => {
  try {
    logger.debug({
      message: 'Starting getPlayerJoinListInSameWorldCore',
      datetime: datetime.toISOString(),
    });

    // ワールド情報が渡されていない場合は取得する（後方互換性のため）
    let worldJoinLog = recentWorldJoin;
    if (!worldJoinLog) {
      logger.debug('Finding recent merged world join log');
      const foundWorldJoinLog = await findRecentMergedWorldJoinLog(datetime);
      if (foundWorldJoinLog === null) {
        logger.debug('No recent world join log found');
        return neverthrow.err('RECENT_JOIN_LOG_NOT_FOUND' as const);
      }
      worldJoinLog = foundWorldJoinLog;
    }

    logger.debug({
      message: 'Found recent world join log',
      recentJoinDateTime: worldJoinLog.joinDateTime.toISOString(),
      worldName: worldJoinLog.worldName,
    });

    // 統合されたログから次のワールド参加ログを取得
    logger.debug('Finding next merged world join log');
    const nextWorldJoin = await findNextMergedWorldJoinLog(
      worldJoinLog.joinDateTime,
    );

    const endDateTime = nextWorldJoin?.joinDateTime;

    logger.debug({
      message: 'Query time range determined',
      startDateTime: worldJoinLog.joinDateTime.toISOString(),
      endDateTime: endDateTime?.toISOString() ?? 'unlimited',
      hasNextWorldJoin: nextWorldJoin !== null,
    });

    logger.debug('Querying player join logs');
    const playerJoinLogResult =
      await playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime({
        startJoinDateTime: worldJoinLog.joinDateTime,
        endJoinDateTime: endDateTime ?? null,
      });

    if (playerJoinLogResult.isErr()) {
      // エラータイプに基づいて適切な処理を行う
      const error = playerJoinLogResult.error;
      logger.error({
        message: `プレイヤー参加ログの取得に失敗しました: ${
          error.message
        } (errorType: ${
          error.type
        }, startDateTime: ${worldJoinLog.joinDateTime.toISOString()}, endDateTime: ${endDateTime.toISOString()}, searchRange: ${Math.round(
          (endDateTime.getTime() - worldJoinLog.joinDateTime.getTime()) /
            (1000 * 60 * 60),
        )} hours, worldId: ${worldJoinLog.worldId}, worldName: ${
          worldJoinLog.worldName
        })`,
        stack: new Error(`プレイヤー参加ログエラー: ${error.type}`),
      });

      return match(error.type)
        .with(
          P.union('DATABASE_ERROR', 'INVALID_DATE_RANGE', 'NOT_FOUND'),
          () => neverthrow.err('RECENT_JOIN_LOG_NOT_FOUND' as const),
        )
        .otherwise(() => {
          // 型安全のためのケース（実際には到達しない）
          throw new Error(`未知のエラータイプ: ${JSON.stringify(error)}`);
        });
    }

    const playerJoinLogList = playerJoinLogResult.value;
    if (playerJoinLogList.length === 0) {
      logger.debug('No player join logs found in time range');
      return neverthrow.err('RECENT_JOIN_LOG_NOT_FOUND');
    }

    logger.debug({
      message: 'Successfully retrieved player join logs',
      count: playerJoinLogList.length,
    });

    return neverthrow.ok(playerJoinLogList);
  } catch (error) {
    logger.error({
      message: `Unexpected error in getPlayerJoinListInSameWorldCore for datetime ${datetime.toISOString()}: ${error}`,
      stack: match(error)
        .with(P.instanceOf(Error), (err) => err)
        .otherwise((err) => new Error(String(err))),
    });

    // Re-throw the error to be caught by the cache layer
    throw UserFacingError.withStructuredInfo({
      code: ERROR_CODES.DATABASE_ERROR,
      category: ERROR_CATEGORIES.DATABASE_ERROR,
      message: `Failed to get player join list: ${error}`,
      userMessage: 'プレイヤー情報の取得中にエラーが発生しました。',
      cause: match(error)
        .with(P.instanceOf(Error), (err) => err)
        .otherwise((err) => new Error(String(err))),
    });
  }
};

export const logInfoRouter = () =>
  trpcRouter({
    loadLogInfoIndex: procedure
      .input(
        z.object({
          excludeOldLogLoad: z.boolean(),
        }),
      )
      .mutation(async (ctx) => {
        logger.info('loadLogInfoIndex');
        const result = await loadLogInfoIndexFromVRChatLog({
          excludeOldLogLoad: ctx.input.excludeOldLogLoad,
        });
        if (result.isErr()) {
          return neverthrow.err(result.error);
        }
      }),
    getVRCWorldJoinLogList: procedure.query(async () => {
      const joinLogList = await getVRCWorldJoinLogList();
      return joinLogList;
    }),
    /**
     * よく遊ぶプレイヤー名のリストを取得する
     * @param limit - 最大取得件数（デフォルト: 5）
     * @returns よく遊ぶプレイヤー名の配列（頻度順）
     */
    getFrequentPlayerNames: procedure
      .input(z.object({ limit: z.number().min(1).max(20).default(5) }))
      .query(async ({ input }) => {
        const result = await getFrequentPlayerNames(input.limit);
        return result.match(
          (value) => value,
          (error) => {
            throw UserFacingError.withStructuredInfo({
              code: ERROR_CODES.DATABASE_ERROR,
              category: ERROR_CATEGORIES.DATABASE_ERROR,
              message: `Failed to get frequent player names: ${error}`,
              userMessage: 'よく一緒に遊ぶプレイヤーの取得に失敗しました。',
              cause: error,
            });
          },
        );
      }),
    getRecentVRChatWorldJoinLogByVRChatPhotoName: procedure
      .input(VRChatPhotoFileNameWithExtSchema)
      .query(async (ctx) => {
        logger.info('getRecentVRChatWorldJoinLogByVRChatPhotoName', ctx.input);
        const joinLogResult =
          await getRecentVRChatWorldJoinLogByVRChatPhotoName(ctx.input);
        return joinLogResult.match(
          (value) => {
            return value;
          },
          (error) => {
            throw UserFacingError.withStructuredInfo({
              code: ERROR_CODES.DATABASE_ERROR,
              category: ERROR_CATEGORIES.DATABASE_ERROR,
              message: `Failed to get recent world join log: ${error}`,
              userMessage: '写真に関連するワールド情報の取得に失敗しました。',
              cause: new Error(String(error)),
            });
          },
        );
      }),
    /**
     * 同じワールドにいたプレイヤーのリストを取得
     * @param datetime - 参加日時
     * @returns プレイヤーリスト
     */
    getPlayerListInSameWorld: procedure.input(z.date()).query(async (ctx) => {
      const playerJoinLogListResult = await getPlayerJoinListInSameWorld(
        ctx.input,
      );
      if (playerJoinLogListResult.isErr()) {
        return match(playerJoinLogListResult.error)
          .with('RECENT_JOIN_LOG_NOT_FOUND', () => {
            logger.debug('getPlayerListInSameWorld: RECENT_JOIN_LOG_NOT_FOUND');
            return [];
          })
          .exhaustive();
      }
      return playerJoinLogListResult.value;
    }),

    /**
     * 検索候補として利用可能なワールド名の一覧を取得する
     * @param query - 検索クエリ（部分一致）
     * @param limit - 最大件数（デフォルト: 10）
     * @returns 検索クエリに一致するワールド名の配列
     */
    getWorldNameSuggestions: procedure
      .input(
        z.object({
          query: z.string().min(1),
          limit: z.number().min(1).max(50).default(10),
        }),
      )
      .query(async ({ input }) => {
        const result = await getWorldNameSuggestions(input.query, input.limit);
        return result.match(
          (value) => value,
          (error) => {
            throw UserFacingError.withStructuredInfo({
              code: ERROR_CODES.DATABASE_ERROR,
              category: ERROR_CATEGORIES.DATABASE_ERROR,
              message: `Failed to get world name suggestions: ${error}`,
              userMessage: 'ワールド名の検索候補の取得に失敗しました。',
              cause: error,
            });
          },
        );
      }),

    /**
     * 検索候補として利用可能なプレイヤー名の一覧を取得する
     * @param query - 検索クエリ（部分一致）
     * @param limit - 最大件数（デフォルト: 10）
     * @returns 検索クエリに一致するプレイヤー名の配列
     */
    getPlayerNameSuggestions: procedure
      .input(
        z.object({
          query: z.string().min(1),
          limit: z.number().min(1).max(50).default(10),
        }),
      )
      .query(async ({ input }) => {
        const result = await getPlayerNameSuggestions(input.query, input.limit);
        return result.match(
          (value) => value,
          (error) => {
            throw UserFacingError.withStructuredInfo({
              code: ERROR_CODES.DATABASE_ERROR,
              category: ERROR_CATEGORIES.DATABASE_ERROR,
              message: `Failed to get player name suggestions: ${error}`,
              userMessage: 'プレイヤー名の検索候補の取得に失敗しました。',
              cause: error,
            });
          },
        );
      }),

    /**
     * プレイヤー名で検索して、そのプレイヤーがいたセッションの参加日時を返す
     * 効率的なサーバーサイド検索により、該当するセッションのみを返します。
     * @param playerName - 検索するプレイヤー名（部分一致）
     * @returns 該当するセッションの参加日時の配列
     */
    searchSessionsByPlayerName: procedure
      .input(
        z.object({
          playerName: z.string().min(1),
        }),
      )
      .query(async ({ input }) => {
        // searchSessionsByPlayerName は Result<Date[], never> を返すため、
        // エラーは発生しない。neverthrow標準の.match()を使用
        const result = await searchSessionsByPlayerName(input.playerName);
        return result.match(
          (sessionDates) => {
            logger.debug(
              `searchSessionsByPlayerName: Found ${sessionDates.length} sessions for player "${input.playerName}"`,
            );
            return sessionDates;
          },
          // Result<T, never> のため、このブランチは型チェックのために必要だが実行されない
          () => {
            throw new Error(
              'Unreachable: searchSessionsByPlayerName should never return an error',
            );
          },
        );
      }),

    /**
     * セッション情報（ワールド情報+プレイヤー情報）を効率的にバッチ取得
     * フロントエンドのバッチマネージャーからの複数リクエストを一つのDBクエリで処理
     * @param joinDateTimes - 参加日時の配列
     * @returns 日時ごとのセッション情報のマップ
     */
    getSessionInfoBatch: procedure
      .input(
        z.array(z.date()).max(BATCH_CONFIG.MAX_SESSION_BATCH_SIZE, {
          message: `セッション情報のバッチ取得は最大${BATCH_CONFIG.MAX_SESSION_BATCH_SIZE}件までです。現在の件数を確認してください。`,
        }),
      )
      .query(async (ctx) => {
        const results: Record<
          string,
          {
            worldId: string | null;
            worldName: string | null;
            worldInstanceId: string | null;
            players: Array<{
              id: string;
              playerId: string | null;
              playerName: string;
              joinDateTime: Date;
              createdAt: Date;
              updatedAt: Date;
            }>;
          }
        > = {};

        if (ctx.input.length === 0) {
          return results;
        }

        // 効率的なワールド参加ログの一括取得
        const sessionRanges: Array<{
          dateKey: string;
          start: Date;
          end: Date | undefined;
          worldId: string;
          worldName: string;
          worldInstanceId: string;
        }> = [];

        try {
          const startTime = performance.now();
          logger.debug(
            `[SessionInfoBatch] Processing batch request for ${ctx.input.length} sessions`,
          );

          // 統合されたワールド参加ログを取得（PhotoAsLogを含む）
          const worldLogStartTime = performance.now();
          const maxDateTime = Math.max(...ctx.input.map((d) => d.getTime()));
          const searchEndTime = new Date(maxDateTime + 1000);

          // 要求された時刻までのログを取得
          const logsBeforeRequest = await fetchAndMergeSortedWorldJoinLogs(
            {
              ltJoinDateTime: searchEndTime,
              orderByJoinDateTime: 'desc',
            },
            'desc',
          );

          // 次のワールド参加ログを1件だけ追加で取得（セッション境界判定のため）
          const nextLogResult = await fetchAndMergeSortedWorldJoinLogs(
            {
              gtJoinDateTime: searchEndTime,
              orderByJoinDateTime: 'asc',
            },
            'asc',
          );

          // 2つの結果を統合してソート
          const sortedLogs = [
            ...logsBeforeRequest,
            ...(nextLogResult.length > 0 ? [nextLogResult[0]] : []),
          ].sort((a, b) => b.joinDateTime.getTime() - a.joinDateTime.getTime());

          const worldLogTime = performance.now() - worldLogStartTime;
          logger.debug(
            `[SessionInfoBatch] Merged world join logs retrieved in ${worldLogTime.toFixed(
              2,
            )}ms (${sortedLogs.length} merged logs)`,
          );

          // 各日時に対する最適なワールド参加ログを効率的に見つける（元のロジックと同じ）
          const sessionMappingStartTime = performance.now();
          for (const joinDateTime of ctx.input) {
            const dateKey = joinDateTime.toISOString();
            const searchEndTime = new Date(joinDateTime.getTime() + 1000);

            // 指定時刻以前の最新ログを検索（元のfindRecentMergedWorldJoinLogと同じロジック）
            const recentWorldJoin = sortedLogs.find(
              (log) => log.joinDateTime <= searchEndTime,
            );

            if (!recentWorldJoin) {
              results[dateKey] = {
                worldId: null,
                worldName: null,
                worldInstanceId: null,
                players: [],
              };
              continue;
            }

            // 次のワールド参加ログを検索（時系列順で最初に見つかるもの）
            const nextWorldJoin = sortedLogs
              .filter((log) => log.joinDateTime > recentWorldJoin.joinDateTime)
              .sort(
                (a, b) => a.joinDateTime.getTime() - b.joinDateTime.getTime(),
              )[0];

            const endDateTime = nextWorldJoin?.joinDateTime;

            sessionRanges.push({
              dateKey,
              start: recentWorldJoin.joinDateTime,
              end: endDateTime,
              worldId: recentWorldJoin.worldId,
              worldName: recentWorldJoin.worldName,
              worldInstanceId: recentWorldJoin.worldInstanceId,
            });

            logger.debug(
              `[SessionInfoBatch] Session range for ${dateKey}: ${recentWorldJoin.joinDateTime.toISOString()} to ${
                endDateTime?.toISOString() || 'undefined'
              } (${recentWorldJoin.worldName})`,
            );

            // 初期化（プレイヤー情報は後で追加）
            results[dateKey] = {
              worldId: recentWorldJoin.worldId,
              worldName: recentWorldJoin.worldName,
              worldInstanceId: recentWorldJoin.worldInstanceId,
              players: [],
            };
          }

          const sessionMappingTime =
            performance.now() - sessionMappingStartTime;
          logger.debug(
            `[SessionInfoBatch] Session mapping completed in ${sessionMappingTime.toFixed(
              2,
            )}ms (${sessionRanges.length} valid sessions)`,
          );

          // プレイヤー情報を効率的に一括取得
          if (sessionRanges.length > 0) {
            const playerQueryStartTime = performance.now();
            const dateRanges = sessionRanges.map((range) => ({
              start: range.start,
              end: range.end,
              key: range.dateKey,
            }));

            logger.debug(
              `[SessionInfoBatch] Fetching player data for ${dateRanges.length} session ranges`,
            );

            const playerBatchResult =
              await playerJoinLogService.getVRChatPlayerJoinLogListByMultipleDateRanges(
                dateRanges,
              );

            const playerQueryTime = performance.now() - playerQueryStartTime;

            if (playerBatchResult.isOk()) {
              const playersBySession = playerBatchResult.value;
              let totalPlayersFound = 0;

              // 各セッションにプレイヤー情報を設定
              for (const range of sessionRanges) {
                const players = playersBySession[range.dateKey] || [];
                totalPlayersFound += players.length;
                if (results[range.dateKey]) {
                  results[range.dateKey].players = players;
                }
              }

              logger.debug(
                `[SessionInfoBatch] Player data retrieved in ${playerQueryTime.toFixed(
                  2,
                )}ms (${totalPlayersFound} total players)`,
              );
            } else {
              logger.warn({
                message: `プレイヤー情報の取得に失敗しましたが、ワールド情報は返します: ${playerBatchResult.error.message}`,
              });
              logger.debug(
                `[SessionInfoBatch] Player query failed in ${playerQueryTime.toFixed(
                  2,
                )}ms`,
              );
            }
          }

          const totalTime = performance.now() - startTime;
          logger.debug(
            `[SessionInfoBatch] Batch processing completed in ${totalTime.toFixed(
              2,
            )}ms for ${ctx.input.length} sessions`,
          );

          return results;
        } catch (error) {
          // バッチ処理のエラーは予期しないエラーなので上位に伝播（Sentryに送信される）
          // ユーザーにはUserFacingErrorで適切なメッセージを表示
          throw UserFacingError.withStructuredInfo({
            code: ERROR_CODES.DATABASE_ERROR,
            category: ERROR_CATEGORIES.DATABASE_ERROR,
            message: `[SessionInfoBatch] バッチ処理でエラーが発生しました: ${match(
              error,
            )
              .with(P.instanceOf(Error), (err) => err.message)
              .otherwise((err) => String(err))} (requested sessions: ${
              ctx.input.length
            })`,
            userMessage: 'セッション情報の取得中にエラーが発生しました。',
            cause: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }),
  });
