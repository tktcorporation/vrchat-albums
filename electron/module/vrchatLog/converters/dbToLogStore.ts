import * as datefns from 'date-fns';
import { match } from 'ts-pattern';
import type { VRChatLogLine } from '../model';
import { VRChatLogLineSchema } from '../model';

/**
 * DBレコードをlogStore形式に逆変換するモジュール
 */

// DBレコードの型定義
export interface DBLogRecord {
  id: string;
  worldId: string;
  worldName: string;
  worldInstanceId: string;
  joinDateTime: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlayerJoinLogRecord {
  id: string;
  playerName: string;
  playerId: string | null;
  joinDateTime: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlayerLeaveLogRecord {
  id: string;
  playerName: string;
  playerId: string | null;
  leaveDateTime: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExportOptions {
  startDate?: Date;
  endDate?: Date;
  outputPath?: string;
}

// TODO: アプリイベントの型は今後実装
// export interface AppEventLogRecord {
//   id: string;
//   eventType: 'APP_START' | 'APP_EXIT' | 'APP_VERSION';
//   eventDateTime: Date;
//   eventData?: string;
//   createdAt: Date;
//   updatedAt: Date;
// }

export interface LogRecord {
  type: 'worldJoin' | 'playerJoin' | 'playerLeave'; // TODO: 'appEvent' は今後実装
  record: DBLogRecord | PlayerJoinLogRecord | PlayerLeaveLogRecord;
  // TODO: | AppEventLogRecord;
  // NOTE: worldLeaveはDBに保存されないため、LogRecordには含まれない
}

/**
 * 日付を logStore 形式（YYYY.MM.DD HH:mm:ss）にフォーマット
 */
const formatLogDateTime = (date: Date): string => {
  return datefns.format(date, 'yyyy.MM.dd HH:mm:ss');
};

/**
 * ワールド参加ログをlogStore形式のログ行に変換
 * @param worldJoinLog ワールド参加ログのDBレコード
 * @returns logStore形式のログ行配列（2行：参加行とルーム作成行）
 */
export const convertWorldJoinLogToLogLines = (
  worldJoinLog: DBLogRecord,
): VRChatLogLine[] => {
  const dateTimeStr = formatLogDateTime(worldJoinLog.joinDateTime);

  const joiningLine = VRChatLogLineSchema.parse(
    `${dateTimeStr} Log        -  [Behaviour] Joining ${worldJoinLog.worldId}:${worldJoinLog.worldInstanceId}`,
  );

  const roomLine = VRChatLogLineSchema.parse(
    `${dateTimeStr} Log        -  [Behaviour] Joining or Creating Room: ${worldJoinLog.worldName}`,
  );

  return [joiningLine, roomLine];
};

// TODO: アプリイベントログの変換は今後実装
// /**
//  * アプリイベントログをlogStore形式のログ行に変換
//  * @param appEventLog アプリイベントログのDBレコード
//  * @returns logStore形式のログ行
//  */
// export const convertAppEventLogToLogLine = (
//   appEventLog: AppEventLogRecord,
// ): VRChatLogLine => {
//   const dateTimeStr = formatLogDateTime(appEventLog.eventDateTime);
//
//   let logLine: string;
//
//   switch (appEventLog.eventType) {
//     case 'APP_START':
//       logLine = `${dateTimeStr} Log        -  VRC Analytics Initialized`;
//       break;
//     case 'APP_EXIT': {
//       // Use eventData to determine specific exit type if available
//       const exitType = appEventLog.eventData || 'OnApplicationQuit';
//       if (exitType === 'handleQuit') {
//         logLine = `${dateTimeStr} Log        -  VRCApplication: HandleApplicationQuit`;
//       } else if (exitType === 'pause') {
//         logLine = `${dateTimeStr} Log        -  OnApplicationPause`;
//       } else if (exitType === 'quit') {
//         logLine = `${dateTimeStr} Log        -  OnApplicationQuit`;
//       } else if (exitType === 'terminating') {
//         logLine = `${dateTimeStr} Log        -  Application terminating`;
//       } else if (exitType === 'shutdown') {
//         logLine = `${dateTimeStr} Log        -  Shutting down`;
//       } else {
//         logLine = `${dateTimeStr} Log        -  OnApplicationQuit`;
//       }
//       break;
//     }
//     case 'APP_VERSION': {
//       const version = appEventLog.eventData || 'Unknown';
//       logLine = `${dateTimeStr} Log        -  Application.version: ${version}`;
//       break;
//     }
//     default:
//       // Should never happen with TypeScript, but handle gracefully
//       logLine = `${dateTimeStr} Log        -  Unknown app event`;
//   }
//
//   return VRChatLogLineSchema.parse(logLine);
// };

/**
 * プレイヤー参加/退出ログをlogStore形式のログ行に変換する共通関数
 * @param options 変換に必要な情報
 * @returns logStore形式のログ行
 */
const createPlayerActionLogLine = (options: {
  dateTime: Date;
  playerName: string;
  playerId: string | null;
  action: 'Joined' | 'Left';
}): VRChatLogLine => {
  const dateTimeStr = formatLogDateTime(options.dateTime);
  const playerIdSuffix = options.playerId ? ` (${options.playerId})` : '';

  return VRChatLogLineSchema.parse(
    `${dateTimeStr} Log        -  [Behaviour] OnPlayer${options.action} ${options.playerName}${playerIdSuffix}`,
  );
};

/**
 * プレイヤー参加ログをlogStore形式のログ行に変換
 * @param playerJoinLog プレイヤー参加ログのDBレコード
 * @returns logStore形式のログ行
 */
export const convertPlayerJoinLogToLogLine = (
  playerJoinLog: PlayerJoinLogRecord,
): VRChatLogLine => {
  return createPlayerActionLogLine({
    dateTime: playerJoinLog.joinDateTime,
    playerName: playerJoinLog.playerName,
    playerId: playerJoinLog.playerId,
    action: 'Joined',
  });
};

/**
 * プレイヤー退出ログをlogStore形式のログ行に変換
 * @param playerLeaveLog プレイヤー退出ログのDBレコード
 * @returns logStore形式のログ行
 */
export const convertPlayerLeaveLogToLogLine = (
  playerLeaveLog: PlayerLeaveLogRecord,
): VRChatLogLine => {
  return createPlayerActionLogLine({
    dateTime: playerLeaveLog.leaveDateTime,
    playerName: playerLeaveLog.playerName,
    playerId: playerLeaveLog.playerId,
    action: 'Left',
  });
};

/**
 * 各ログレコードから対応する日時を取得
 */
const getLogDateTime = (logRecord: LogRecord): Date => {
  return (
    match(logRecord)
      .with(
        { type: 'worldJoin' },
        (record) => (record.record as DBLogRecord).joinDateTime,
      )
      .with(
        { type: 'playerJoin' },
        (record) => (record.record as PlayerJoinLogRecord).joinDateTime,
      )
      .with(
        { type: 'playerLeave' },
        (record) => (record.record as PlayerLeaveLogRecord).leaveDateTime,
      )
      // TODO: アプリイベントの処理は今後実装
      // .with(
      //   { type: 'appEvent' },
      //   (record) => (record.record as AppEventLogRecord).eventDateTime,
      // )
      .exhaustive()
  );
};

/**
 * 複数のDBレコードをlogStore形式に変換し、時系列順でソート
 * @param logRecords 変換対象のログレコード配列
 * @returns 時系列順にソートされたlogStore形式のログ行配列
 */
export const exportLogsToLogStore = (
  logRecords: LogRecord[],
): VRChatLogLine[] => {
  // 時系列順にソート
  const sortedRecords = [...logRecords].sort((a, b) => {
    const dateA = getLogDateTime(a);
    const dateB = getLogDateTime(b);
    return datefns.compareAsc(dateA, dateB);
  });

  const logLines: VRChatLogLine[] = [];

  for (const logRecord of sortedRecords) {
    const newLines = match(logRecord)
      .with({ type: 'worldJoin' }, (record) => {
        const worldJoinLines = convertWorldJoinLogToLogLines(
          record.record as DBLogRecord,
        );
        return worldJoinLines;
      })
      .with({ type: 'playerJoin' }, (record) => {
        const playerJoinLine = convertPlayerJoinLogToLogLine(
          record.record as PlayerJoinLogRecord,
        );
        return [playerJoinLine];
      })
      .with({ type: 'playerLeave' }, (record) => {
        const playerLeaveLine = convertPlayerLeaveLogToLogLine(
          record.record as PlayerLeaveLogRecord,
        );
        return [playerLeaveLine];
      })
      // TODO: アプリイベントの処理は今後実装
      // .with({ type: 'appEvent' }, (record) => {
      //   const appEventLine = convertAppEventLogToLogLine(
      //     record.record as AppEventLogRecord,
      //   );
      //   return [appEventLine];
      // })
      .exhaustive();

    logLines.push(...newLines);
  }

  return logLines;
};

/**
 * logStore形式のログ行配列を文字列に変換
 * @param logLines logStore形式のログ行配列
 * @returns 改行区切りの文字列
 */
export const formatLogStoreContent = (logLines: VRChatLogLine[]): string => {
  return logLines.join('\n');
};
