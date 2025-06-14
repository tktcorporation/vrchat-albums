import * as nodeFs from 'node:fs';
import path from 'node:path';
import * as datefns from 'date-fns';
import * as neverthrow from 'neverthrow';
import { getAppUserDataPath } from '../../../lib/wrappedApp';
import * as fs from '../../../lib/wrappedFs';
import type { VRChatLogLine, VRChatLogStoreFilePath } from '../model';
import {
  VRChatLogStoreFilePathRegex,
  VRChatLogStoreFilePathSchema,
  createTimestampedLogFilePath,
} from '../model';

/**
 * VRChatログストレージの管理機能
 * ログファイルの保存・読み込み・整理を担当
 */

/**
 * logStoreディレクトリのパスを取得
 * logStoreディレクトリは、VRChatログから抽出した必要な情報のみを保存するディレクトリ
 */
export const getLogStoreDir = (): string => {
  return path.join(getAppUserDataPath(), 'logStore');
};

/**
 * logStoreディレクトリを初期化
 * ディレクトリが存在しない場合は作成する
 */
export const initLogStoreDir = (): void => {
  const logStoreDir = getLogStoreDir();
  if (!nodeFs.existsSync(logStoreDir)) {
    nodeFs.mkdirSync(logStoreDir, { recursive: true });
  }
};

/**
 * 指定された日付に基づいてログストアファイルのパスを生成
 * @param date 対象日付（デフォルトは現在日付）
 * @returns ログストアファイルのパス
 */
export const getLogStoreFilePathForDate = (
  date: Date = new Date(),
): VRChatLogStoreFilePath => {
  const yearMonth = datefns.format(date, 'yyyy-MM');
  const logStoreFilePath = path.join(
    getLogStoreDir(),
    yearMonth,
    `logStore-${yearMonth}.txt`,
  );
  return VRChatLogStoreFilePathSchema.parse(logStoreFilePath);
};

/**
 * 旧形式のログファイルパスを取得
 * @returns 旧形式のログファイルパス、存在しない場合はnull
 */
export const getLegacyLogStoreFilePath =
  async (): Promise<VRChatLogStoreFilePath | null> => {
    const legacyPath = path.join(getLogStoreDir(), 'logStore.txt');
    if (!nodeFs.existsSync(legacyPath)) {
      return null;
    }
    return VRChatLogStoreFilePathSchema.parse(legacyPath);
  };

/**
 * 指定された日付範囲のログストアファイルのパスを取得
 * @param startDate 開始日付
 * @param currentDate 終了日付
 * @returns ログストアファイルパスの配列
 */
export const getLogStoreFilePathsInRange = async (
  startDate: Date,
  currentDate: Date,
): Promise<VRChatLogStoreFilePath[]> => {
  const logFilePathSet = new Set<string>();
  let targetDate = datefns.startOfMonth(startDate);
  const endDate = datefns.endOfMonth(currentDate);

  while (
    datefns.isBefore(targetDate, endDate) ||
    datefns.isSameDay(targetDate, endDate)
  ) {
    const yearMonth = datefns.format(targetDate, 'yyyy-MM');
    const monthDir = path.join(getLogStoreDir(), yearMonth);
    const standardLogFilePath = getLogStoreFilePathForDate(targetDate);

    logFilePathSet.add(standardLogFilePath.value);

    // 同じ月のタイムスタンプ付きのログファイルを検索
    if (nodeFs.existsSync(monthDir)) {
      try {
        const files = nodeFs.readdirSync(monthDir);
        const timestampedLogFiles = files.filter((file) =>
          file.match(VRChatLogStoreFilePathRegex),
        );

        for (const file of timestampedLogFiles) {
          const fullPath = path.join(monthDir, file);
          logFilePathSet.add(fullPath);
        }
      } catch (err) {
        console.error(`Error reading directory ${monthDir}:`, err);
      }
    }

    targetDate = datefns.addMonths(targetDate, 1);
  }

  return Array.from(logFilePathSet).map((p) =>
    VRChatLogStoreFilePathSchema.parse(p),
  );
};

/**
 * ログ行をストレージファイルに追記
 * @param props.logLines 追記するログ行
 * @param props.logStoreFilePath 保存先ファイルパス（省略時は日付から自動決定）
 * @returns 成功時はok、失敗時はerr
 */
export const appendLoglinesToFile = async (props: {
  logLines: VRChatLogLine[];
  logStoreFilePath?: VRChatLogStoreFilePath;
}): Promise<neverthrow.Result<void, never>> => {
  if (props.logLines.length === 0) {
    return neverthrow.ok(undefined);
  }

  // ログを日付ごとにグループ化
  const logsByMonth = new Map<string, VRChatLogLine[]>();

  for (const logLine of props.logLines) {
    const dateMatch = logLine.value.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
    if (!dateMatch) {
      const key = datefns.format(new Date(), 'yyyy-MM');
      const monthLogs = logsByMonth.get(key) || [];
      monthLogs.push(logLine);
      logsByMonth.set(key, monthLogs);
      continue;
    }

    const year = dateMatch[1];
    const month = dateMatch[2];
    const key = `${year}-${month}`;

    const monthLogs = logsByMonth.get(key) || [];
    monthLogs.push(logLine);
    logsByMonth.set(key, monthLogs);
  }

  // 各月のログを対応するファイルに書き込む
  for (const [yearMonth, logs] of logsByMonth.entries()) {
    const [year, month] = yearMonth.split('-');
    const date = datefns.parse(`${year}-${month}-01`, 'yyyy-MM-dd', new Date());

    const monthDir = path.join(getLogStoreDir(), yearMonth);

    initLogStoreDir();

    if (!nodeFs.existsSync(monthDir)) {
      nodeFs.mkdirSync(monthDir, { recursive: true });
    }

    const logStoreFilePath = getLogStoreFilePathForDate(date);
    const isExists = await fs.existsSyncSafe(logStoreFilePath.value);

    // ファイルサイズをチェック（10MB制限）
    if (isExists) {
      const stats = nodeFs.statSync(logStoreFilePath.value);
      if (stats.size >= 10 * 1024 * 1024) {
        const timestamp = new Date();
        const newFilePath = createTimestampedLogFilePath(
          monthDir,
          yearMonth,
          timestamp,
        );

        const newLog = `${logs.map((l) => l.value).join('\n')}\n`;
        const writeResult = await fs.writeFileSyncSafe(newFilePath, newLog);
        if (writeResult.isErr()) {
          throw writeResult.error;
        }
        continue;
      }
    }

    // 既存のログ行をSetとして保持
    const existingLines = new Set<string>();

    if (isExists) {
      const readResult = await fs.readFileSyncSafe(logStoreFilePath.value);
      if (readResult.isOk()) {
        const content = readResult.value.toString();
        for (const line of content.split('\n')) {
          if (line) {
            existingLines.add(line);
          }
        }
      }
    }

    // 重複を除外して新しいログ行を追加
    const newLines = logs.filter((log) => !existingLines.has(log.value));
    if (newLines.length === 0) {
      continue;
    }

    const newLog = `${newLines.map((l) => l.value).join('\n')}\n`;

    // ファイルが存在しない場合は新規作成、存在する場合は追記
    if (!isExists) {
      const writeResult = await fs.writeFileSyncSafe(
        logStoreFilePath.value,
        newLog,
      );
      if (writeResult.isErr()) {
        throw writeResult.error;
      }
    } else {
      const appendResult = await fs.appendFileAsync(
        logStoreFilePath.value,
        newLog,
      );
      if (appendResult.isErr()) {
        throw appendResult.error;
      }
    }
  }

  return neverthrow.ok(undefined);
};
