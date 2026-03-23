import { Effect } from 'effect';

import { enqueueTask } from '../../lib/dbHelper';
import type { VRChatPlayerJoinLog } from '../vrchatLog/service';
import {
  PlayerJoinLogDatabaseError,
  PlayerJoinLogInvalidDateRange,
  type PlayerJoinLogServiceError,
} from './errors';
import * as model from './playerJoinInfoLog.model';

/**
 * VRChatのプレイヤー参加ログを作成する
 * @param playerJoinLogList プレイヤー参加ログのリスト
 * @returns 作成されたプレイヤー参加ログのリスト
 */
export const createVRChatPlayerJoinLogModel = (
  playerJoinLogList: VRChatPlayerJoinLog[],
) => {
  return model.createVRChatPlayerJoinLog(playerJoinLogList);
};

/**
 * プレイヤー参加ログのデータ型
 */
type PlayerJoinLogData = {
  id: string;
  playerId: string | null;
  playerName: string;
  joinDateTime: Date;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * 参加日時の範囲からVRChatのプレイヤー参加ログを取得する
 * @param props.startJoinDateTime 開始日時
 * @param props.endJoinDateTime 終了日時（nullの場合は開始日時から7日間）
 * @returns プレイヤー参加ログのリスト
 */

export const getVRChatPlayerJoinLogListByJoinDateTime = (props: {
  startJoinDateTime: Date;
  endJoinDateTime: Date | null;
}): Effect.Effect<PlayerJoinLogData[], PlayerJoinLogServiceError> => {
  // 日付範囲の検証
  if (
    props.endJoinDateTime &&
    props.startJoinDateTime > props.endJoinDateTime
  ) {
    return Effect.fail(
      new PlayerJoinLogInvalidDateRange({
        message: '開始日時は終了日時より前である必要があります',
      }),
    );
  }

  return Effect.gen(function* () {
    let modelList: model.VRChatPlayerJoinLogModel[];

    // 終了日時が指定されていない場合は無制限に取得
    if (!props.endJoinDateTime) {
      modelList = yield* enqueueTask(() =>
        model.getVRChatPlayerJoinLogListByJoinDateTime({
          gteJoinDateTime: props.startJoinDateTime,
          ltJoinDateTime: null,
          getUntilDays: null,
        }),
      ).pipe(
        Effect.mapError(
          (e) =>
            new PlayerJoinLogDatabaseError({
              message: `プレイヤー参加ログの取得に失敗しました: ${e.message}`,
            }),
        ),
      ) as Effect.Effect<
        model.VRChatPlayerJoinLogModel[],
        PlayerJoinLogServiceError
      >;
    } else {
      const endDate: Date = props.endJoinDateTime;
      modelList = yield* enqueueTask(() =>
        model.getVRChatPlayerJoinLogListByJoinDateTime({
          gteJoinDateTime: props.startJoinDateTime,
          ltJoinDateTime: endDate,
          getUntilDays: null,
        }),
      ).pipe(
        Effect.mapError(
          (e) =>
            new PlayerJoinLogDatabaseError({
              message: `プレイヤー参加ログの取得に失敗しました: ${e.message}`,
            }),
        ),
      ) as Effect.Effect<
        model.VRChatPlayerJoinLogModel[],
        PlayerJoinLogServiceError
      >;
    }

    // 結果が空の場合は空の配列を返す（エラーではない）
    return modelList.map((dbModel) => ({
      id: dbModel.id,
      playerId: dbModel.playerId,
      playerName: dbModel.playerName,
      joinDateTime: dbModel.joinDateTime,
      createdAt: dbModel.createdAt,
      updatedAt: dbModel.updatedAt,
    }));
  });
};

/**
 * 最新の検出日時を取得する
 * @returns 最新の検出日時（ISO文字列）
 */
export const getLatestDetectedDate = (): Effect.Effect<
  string | null,
  PlayerJoinLogServiceError
> => {
  return enqueueTask(() => model.findLatestPlayerJoinLog()).pipe(
    Effect.mapError(
      (e) =>
        new PlayerJoinLogDatabaseError({
          message: `最新の検出日時の取得に失敗しました: ${e.message}`,
        }),
    ),
    Effect.map((latestLog) => latestLog?.joinDateTime.toISOString() ?? null),
  );
};

/**
 * 複数の日時範囲のプレイヤー参加ログを一度に取得する（効率的なバッチクエリ）
 * @param dateRanges 日時範囲の配列 { start: Date, end: Date, key: string }
 * @returns 日時範囲ごとのプレイヤー参加ログのマップ
 */
export const getVRChatPlayerJoinLogListByMultipleDateRanges = (
  dateRanges: Array<{ start: Date; end: Date | undefined; key: string }>,
): Effect.Effect<
  Record<string, PlayerJoinLogData[]>,
  PlayerJoinLogServiceError
> => {
  if (dateRanges.length === 0) {
    return Effect.succeed({});
  }

  return Effect.gen(function* () {
    // endがundefinedの場合はnullとしてそのまま渡す
    const normalizedDateRanges = dateRanges.map((range) => ({
      ...range,
      end: range.end ?? null,
    }));

    // 複数の日時範囲を一つのクエリで処理するためのUNIONクエリを構築
    const modelList = yield* enqueueTask(() =>
      model.getVRChatPlayerJoinLogListByMultipleDateRanges(
        normalizedDateRanges,
      ),
    ).pipe(
      Effect.mapError(
        (e) =>
          new PlayerJoinLogDatabaseError({
            message: `複数範囲のプレイヤー参加ログの取得に失敗しました: ${e.message}`,
          }),
      ),
    ) as Effect.Effect<
      Array<model.VRChatPlayerJoinLogModel & { range_key: string }>,
      PlayerJoinLogServiceError
    >;

    // 結果をキーごとにグループ化
    const groupedResults: Record<string, PlayerJoinLogData[]> = {};

    for (const dbModel of modelList) {
      const key = dbModel.range_key;
      if (!groupedResults[key]) {
        groupedResults[key] = [];
      }
      groupedResults[key].push({
        id: dbModel.id,
        playerId: dbModel.playerId,
        playerName: dbModel.playerName,
        joinDateTime: dbModel.joinDateTime,
        createdAt: dbModel.createdAt,
        updatedAt: dbModel.updatedAt,
      });
    }

    // 空の結果の場合、各キーに空配列を設定
    for (const { key } of dateRanges) {
      if (!groupedResults[key]) {
        groupedResults[key] = [];
      }
    }

    return groupedResults;
  });
};

/**
 * 最新のプレイヤー参加ログを取得する
 * @returns 最新のプレイヤー参加ログ
 */
export const findLatestPlayerJoinLog = (): Effect.Effect<
  model.VRChatPlayerJoinLogModel | null,
  PlayerJoinLogServiceError
> => {
  return enqueueTask(() => model.findLatestPlayerJoinLog()).pipe(
    Effect.mapError(
      (e) =>
        new PlayerJoinLogDatabaseError({
          message: `最新のプレイヤー参加ログの取得に失敗しました: ${e.message}`,
        }),
    ),
  );
};
