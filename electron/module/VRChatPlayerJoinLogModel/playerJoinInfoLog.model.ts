import {
  type CreationOptional,
  DataTypes,
  type InferAttributes,
  type InferCreationAttributes,
  Model,
  Op,
} from '@sequelize/core';
import {
  AllowNull,
  Attribute,
  createIndexDecorator,
  Default,
  NotNull,
  PrimaryKey,
  Table,
} from '@sequelize/core/decorators-legacy';
import * as dateFns from 'date-fns';
import { uuidv7 } from 'uuidv7';

import type { VRChatPlayerJoinLog } from '../vrchatLog/service';

const PlayerNameJoinDateTimeIndex = createIndexDecorator(
  'PlayerNameJoinDateTimeIndex',
  {
    name: 'playerName-joinDateTime',
    concurrently: true,
    unique: true,
  },
);

const JoinDateTimeIndex = createIndexDecorator('JoinDateTimeIndex', {
  name: 'joinDateTime-idx',
  concurrently: true,
});

@Table({ tableName: 'VRChatPlayerJoinLogModels' })
/**
 * プレイヤー参加ログを保存するモデル。
 *
 * @see docs/log-sync-architecture.md - ログ同期の設計
 * @see docs/photo-grouping-logic.md - セッション単位の写真グループ化
 * @see VRChatPlayerLeaveLogModel - 退出ログモデル
 */
export class VRChatPlayerJoinLogModel extends Model<
  InferAttributes<VRChatPlayerJoinLogModel>,
  InferCreationAttributes<VRChatPlayerJoinLogModel>
> {
  @Attribute(DataTypes.UUID)
  @PrimaryKey
  @Default(uuidv7)
  declare id: CreationOptional<string>;

  @Attribute(DataTypes.STRING)
  @AllowNull
  declare playerId: string | null;

  @Attribute(DataTypes.STRING)
  @NotNull
  @PlayerNameJoinDateTimeIndex
  declare playerName: string;

  @Attribute(DataTypes.DATE)
  @NotNull
  @PlayerNameJoinDateTimeIndex
  @JoinDateTimeIndex
  declare joinDateTime: Date;

  @Attribute(DataTypes.DATE)
  @Default(DataTypes.NOW)
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

/**
 * 重複を除外しつつプレイヤー参加ログを一括登録する
 * サービス層の createVRChatPlayerJoinLogModel から利用される
 */
export const createVRChatPlayerJoinLog = async (
  playerJoinLogList: VRChatPlayerJoinLog[],
): Promise<VRChatPlayerJoinLogModel[]> => {
  const existingLogs = await VRChatPlayerJoinLogModel.findAll({
    attributes: ['joinDateTime', 'playerName'],
  });

  const existingSet = new Set(
    existingLogs.map(
      (log) => `${log.joinDateTime.toISOString()}|${log.playerName}`,
    ),
  );

  const seen = new Set();
  const newLogsExcludeDup = playerJoinLogList
    .filter((logInfo) => {
      const key = `${logInfo.joinDate.toISOString()}|${logInfo.playerName}`;
      if (existingSet.has(key) || seen.has(key)) {
        return false; // 既存セットまたは新しいセットに重複が見つかった場合は除外
      }
      seen.add(key); // 初めて見た組み合わせを新しいセットに追加
      return true; // ユニークな組み合わせの場合は残す
    })
    .map((logInfo) => ({
      joinDateTime: logInfo.joinDate,
      playerId: logInfo.playerId ?? null,
      playerName: logInfo.playerName,
    }));

  if (newLogsExcludeDup.length < 1) {
    return [];
  }
  return await VRChatPlayerJoinLogModel.bulkCreate(newLogsExcludeDup);
};

/**
 * joinDateTime を２つ取得して、その間にある playerJoinLog を取得する
 * endJoinDateTime がない場合は以降のデータを最大n日分取得する
 */
export const getVRChatPlayerJoinLogListByJoinDateTime = async (
  props:
    | {
        gteJoinDateTime: Date;
        ltJoinDateTime: Date;
        getUntilDays: null;
      }
    | {
        gteJoinDateTime: Date;
        ltJoinDateTime: null;
        // endJoinDateTime がない場合は以降のデータを最大n日分取得する
        getUntilDays: number;
      }
    | {
        gteJoinDateTime: Date;
        ltJoinDateTime: null;
        // getUntilDaysもnullの場合は無制限に取得する
        getUntilDays: null;
      },
): Promise<VRChatPlayerJoinLogModel[]> => {
  if (props.ltJoinDateTime === null) {
    if (props.getUntilDays === null) {
      // 無制限に取得
      const playerJoinLogList = await VRChatPlayerJoinLogModel.findAll({
        where: {
          joinDateTime: {
            [Op.gte]: props.gteJoinDateTime,
          },
        },
      });
      return playerJoinLogList;
    }
    // 指定された日数分取得
    const playerJoinLogList = await VRChatPlayerJoinLogModel.findAll({
      where: {
        joinDateTime: {
          [Op.gte]: props.gteJoinDateTime,
          [Op.lt]: dateFns.addDays(props.gteJoinDateTime, props.getUntilDays),
        },
      },
    });
    return playerJoinLogList;
  }
  const playerJoinLogList = await VRChatPlayerJoinLogModel.findAll({
    where: {
      joinDateTime: {
        [Op.gte]: props.gteJoinDateTime,
        [Op.lt]: props.ltJoinDateTime,
      },
    },
  });
  return playerJoinLogList;
};

/**
 * 複数の日時範囲のプレイヤー参加ログを一度のクエリで取得する
 * @param dateRanges 日時範囲の配列 { start: Date, end: Date, key: string }
 * @returns 各日時範囲のキーが含まれたプレイヤー参加ログの配列
 */
export const getVRChatPlayerJoinLogListByMultipleDateRanges = async (
  dateRanges: Array<{ start: Date; end: Date | null; key: string }>,
): Promise<Array<VRChatPlayerJoinLogModel & { range_key: string }>> => {
  if (dateRanges.length === 0) {
    return [];
  }

  // 複数の範囲を OR 条件で結合したクエリを作成
  const whereConditions = dateRanges.map(({ start, end }) => {
    if (end === null) {
      return {
        joinDateTime: {
          [Op.gte]: start,
        },
      };
    }
    return {
      joinDateTime: {
        [Op.gte]: start,
        [Op.lt]: end,
      },
    };
  });

  const playerJoinLogList = await VRChatPlayerJoinLogModel.findAll({
    where: {
      [Op.or]: whereConditions,
    },
    order: [['joinDateTime', 'ASC']],
  });

  // 各レコードにどの範囲に属するかのキーを追加
  const resultsWithKeys = playerJoinLogList.map((log) => {
    // このレコードがどの範囲に属するかを特定
    const matchingRange = dateRanges.find(({ start, end }) => {
      if (end === null) {
        return log.joinDateTime >= start;
      }
      return log.joinDateTime >= start && log.joinDateTime < end;
    });

    return {
      ...log.dataValues,
      range_key: matchingRange?.key || 'unknown',
    } as VRChatPlayerJoinLogModel & { range_key: string };
  });

  return resultsWithKeys;
};

/**
 * 最後に検出されたプレイヤー参加ログを取得する
 * ログ同期の進捗確認に使用される
 */
export const findLatestPlayerJoinLog = async () => {
  return VRChatPlayerJoinLogModel.findOne({
    order: [['joinDateTime', 'DESC']],
  });
};
