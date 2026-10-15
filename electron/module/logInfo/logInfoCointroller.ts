import {
  buildWorldSessions,
  findSessionStartingAt,
} from '@shared/worldSession';
import { Effect } from 'effect';
import { match, P } from 'ts-pattern';
import z from 'zod';

import { MAX_SESSION_BATCH_SIZE } from '../../constants/batchConfig';
import { runEffect, runEffectExit } from '../../lib/effectTRPC';
import { toUserFacing } from '../../lib/errorMapping';
import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  UserFacingError,
} from '../../lib/errors';
import * as playerJoinLogService from '../VRChatPlayerJoinLogModel/playerJoinLog.service';
import * as worldJoinLogService from '../vrchatWorldJoinLog/service';
import { logger } from './../../lib/logger';
import { procedure, router as trpcRouter } from './../../trpc';
import {
  fetchAndMergeSortedWorldJoinLogs,
  getFrequentPlayerNames,
  getPlayerNameSuggestions,
  getWorldNameSuggestions,
  searchSessionsByPlayerName,
} from './service';

/**
 * ワールド参加ログ DB エラー → UserFacingError 変換。
 * 「ワールド参加ログの取得中にエラー」を一貫して表示するための SSOT。
 */
const mapWorldJoinLogDbError = toUserFacing<{ message: string }>({
  code: ERROR_CODES.DATABASE_ERROR,
  category: ERROR_CATEGORIES.DATABASE_ERROR,
  userMessage: 'ワールド参加ログの取得中にエラーが発生しました。',
});

/**
 * すべてのワールド参加ログを取得し、tRPC 用の形式に変換する
 *
 * DBHelperError を UserFacingError に変換して E チャネルで返す。
 * tRPC procedure 境界で runEffect により実行される。
 */
const getVRCWorldJoinLogList = (): Effect.Effect<
  {
    id: string;
    worldId: string;
    worldName: string;
    worldInstanceId: string;
    joinDateTime: Date;
    createdAt: Date;
    updatedAt: Date;
  }[],
  UserFacingError
> =>
  worldJoinLogService.findAllVRChatWorldJoinLogList().pipe(
    Effect.map((joinLogList) =>
      joinLogList.map((joinLog) => ({
        id: joinLog.id as string,
        worldId: joinLog.worldId,
        worldName: joinLog.worldName,
        worldInstanceId: joinLog.worldInstanceId,
        joinDateTime: joinLog.joinDateTime,
        createdAt: joinLog.createdAt as Date,
        updatedAt: joinLog.updatedAt as Date,
      })),
    ),
    Effect.mapError(mapWorldJoinLogDbError),
  );

export const logInfoRouter = () =>
  trpcRouter({
    getVRCWorldJoinLogList: procedure.query(async () => {
      return runEffect(getVRCWorldJoinLogList());
    }),
    /**
     * よく遊ぶプレイヤー名のリストを取得する
     * @param limit - 最大取得件数（デフォルト: 5）
     * @returns よく遊ぶプレイヤー名の配列（頻度順）
     */
    getFrequentPlayerNames: procedure
      .input(z.object({ limit: z.number().min(1).max(20).default(5) }))
      .query(async ({ input }) => {
        // getFrequentPlayerNames は Effect<string[], never> を返す（エラーなし）
        return Effect.runPromise(getFrequentPlayerNames(input.limit));
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
        // getWorldNameSuggestions は Effect<string[], never> を返す（エラーなし）
        return Effect.runPromise(
          getWorldNameSuggestions(input.query, input.limit),
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
        // getPlayerNameSuggestions は Effect<string[], never> を返す（エラーなし）
        return Effect.runPromise(
          getPlayerNameSuggestions(input.query, input.limit),
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
        // searchSessionsByPlayerName は Effect<Date[], never> を返すため、エラーは発生しない
        const sessionDates = await Effect.runPromise(
          searchSessionsByPlayerName(input.playerName),
        );
        logger.debug(
          `searchSessionsByPlayerName: Found ${sessionDates.length} sessions for player "${input.playerName}"`,
        );
        return sessionDates;
      }),

    /**
     * セッション情報（ワールド情報+プレイヤー情報）を効率的にバッチ取得
     * フロントエンドのバッチマネージャーからの複数リクエストを一つのDBクエリで処理
     *
     * 入力はギャラリーのグループの joinDateTime（セッションの開始日時）。
     * その日時で始まるセッションの区間 `[join, nextJoin)` に参加したプレイヤーを返し、
     * 時刻からセッションを引き直すことはしない。区切りは `@shared/worldSession` の判定と
     * 通常ログ + 写真由来ログのマージ済み参加ログに従い、ギャラリーのグループと一致する。
     * 開始日時が一致するセッションが無い日時は、ワールド情報 null・プレイヤー空で返す。
     *
     * @param joinDateTimes - セッション開始日時の配列
     * @returns 日時（toISOString）ごとのセッション情報のマップ
     */
    getSessionInfoBatch: procedure
      .input(
        z.array(z.date()).max(MAX_SESSION_BATCH_SIZE, {
          message: `セッション情報のバッチ取得は最大${MAX_SESSION_BATCH_SIZE}件までです。現在の件数を確認してください。`,
        }),
      )
      .query(async (ctx) => {
        type SessionInfoResult = Record<
          string,
          {
            worldId: string | null;
            worldName: string | null;
            worldInstanceId: string | null;
            players: {
              id: string;
              playerId: string | null;
              playerName: string;
              joinDateTime: Date;
              createdAt: Date;
              updatedAt: Date;
            }[];
          }
        >;

        const results: SessionInfoResult = {};

        if (ctx.input.length === 0) {
          return results;
        }

        // 効率的なワールド参加ログの一括取得
        const sessionRanges: {
          dateKey: string;
          start: Date;
          end: Date | undefined;
          worldId: string;
          worldName: string;
          worldInstanceId: string;
        }[] = [];

        // effect-lint-allow-try-catch: tRPC procedure 境界
        try {
          const startTime = performance.now();
          logger.debug(
            `[SessionInfoBatch] Processing batch request for ${ctx.input.length} sessions`,
          );

          // 要求された開始日時を含む範囲の参加ログと、その直後の参加ログ 1 件を取得する
          // （直後の 1 件は最後に要求されたセッションの終端になる）。gt / lt は境界を
          // 含まないため、1ms 広げて要求日時ちょうどの参加ログを含める
          const worldLogStartTime = performance.now();
          const requestedTimes = ctx.input.map((d) => d.getTime());
          const minRequestedTime = Math.min(...requestedTimes);
          const maxRequestedTime = Math.max(...requestedTimes);

          const [logsInRange, logsAfterRange] = await Effect.runPromise(
            Effect.all([
              fetchAndMergeSortedWorldJoinLogs(
                {
                  gtJoinDateTime: new Date(minRequestedTime - 1),
                  ltJoinDateTime: new Date(maxRequestedTime + 1),
                  orderByJoinDateTime: 'asc',
                },
                'asc',
              ),
              fetchAndMergeSortedWorldJoinLogs(
                {
                  gtJoinDateTime: new Date(maxRequestedTime),
                  orderByJoinDateTime: 'asc',
                },
                'asc',
              ),
            ]),
          );

          const sessions = buildWorldSessions([
            ...logsInRange,
            ...logsAfterRange.slice(0, 1),
          ]);

          const worldLogTime = performance.now() - worldLogStartTime;
          logger.debug(
            `[SessionInfoBatch] Merged world join logs retrieved in ${worldLogTime.toFixed(
              2,
            )}ms (${sessions.length} sessions)`,
          );

          const sessionMappingStartTime = performance.now();
          for (const joinDateTime of ctx.input) {
            const dateKey = joinDateTime.toISOString();
            const session = findSessionStartingAt(sessions, joinDateTime);

            if (session === null) {
              results[dateKey] = {
                worldId: null,
                worldName: null,
                worldInstanceId: null,
                players: [],
              };
              continue;
            }

            sessionRanges.push({
              dateKey,
              start: session.join.joinDateTime,
              end: session.nextJoinDateTime,
              worldId: session.join.worldId,
              worldName: session.join.worldName,
              worldInstanceId: session.join.worldInstanceId,
            });

            logger.debug(
              `[SessionInfoBatch] Session range for ${dateKey}: ${session.join.joinDateTime.toISOString()} to ${
                session.nextJoinDateTime?.toISOString() ?? 'undefined'
              } (${session.join.worldName})`,
            );

            // 初期化（プレイヤー情報は後で追加）
            results[dateKey] = {
              worldId: session.join.worldId,
              worldName: session.join.worldName,
              worldInstanceId: session.join.worldInstanceId,
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

            const playerBatchResult = await runEffectExit(
              playerJoinLogService.getVRChatPlayerJoinLogListByMultipleDateRanges(
                dateRanges,
              ),
            );

            const playerQueryTime = performance.now() - playerQueryStartTime;

            if (playerBatchResult.success) {
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
              logger.warnWithSentry({
                message: `プレイヤー情報の取得に失敗しましたが、ワールド情報は返します: ${playerBatchResult.error.message}`,
                details: { errorType: playerBatchResult.error._tag },
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
              .otherwise(String)} (requested sessions: ${ctx.input.length})`,
            userMessage: 'セッション情報の取得中にエラーが発生しました。',
            cause: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }),
  });
