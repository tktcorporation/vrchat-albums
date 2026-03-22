import * as nodeFs from 'node:fs';
import path from 'node:path';

import * as datefns from 'date-fns';
import { Cause, Effect, Exit, Option } from 'effect';

import { logger } from '../../../lib/logger';
import { getAppUserDataPath } from '../../../lib/wrappedApp';
import * as fs from '../../../lib/wrappedFs';
import type { VRChatLogLine, VRChatLogStoreFilePath } from '../model';
import {
  createTimestampedLogFilePath,
  VRChatLogStoreFilePathRegex,
  VRChatLogStoreFilePathSchema,
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

    // 標準ログファイルが存在する場合のみ追加
    if (nodeFs.existsSync(standardLogFilePath.value)) {
      logFilePathSet.add(standardLogFilePath.value);
    }

    // 同じ月のタイムスタンプ付きのログファイルを検索
    if (nodeFs.existsSync(monthDir)) {
      const safeReaddir = Effect.try({
        try: () => nodeFs.readdirSync(monthDir),
        catch: (
          e,
        ): { type: 'READDIR_FAILED'; path: string; message: string } => ({
          type: 'READDIR_FAILED',
          path: monthDir,
          message: e instanceof Error ? e.message : String(e),
        }),
      });
      const readdirExit = Effect.runSyncExit(safeReaddir);
      if (Exit.isSuccess(readdirExit)) {
        const timestampedLogFiles = readdirExit.value.filter((file) =>
          file.match(VRChatLogStoreFilePathRegex),
        );
        for (const file of timestampedLogFiles) {
          const fullPath = path.join(monthDir, file);
          logFilePathSet.add(fullPath);
        }
      } else {
        // ディレクトリ読み取り失敗は警告のみで継続
        const failOpt = Cause.failureOption(readdirExit.cause);
        if (Option.isSome(failOpt)) {
          const error = failOpt.value;
          logger.warn(
            `Failed to read directory ${error.path}: ${error.message}`,
          );
        }
      }
    }

    targetDate = datefns.addMonths(targetDate, 1);
  }

  return Array.from(logFilePathSet).map((p) =>
    VRChatLogStoreFilePathSchema.parse(p),
  );
};

/**
 * 重複判定キャッシュ
 *
 * 背景: appendLoglinesToFile はストリーミング処理で複数回呼ばれるが、
 * 毎回 logStore ファイル全体を読み込んで Set を構築するのは無駄。
 * sync 操作の開始時に createDedupCache() で作成し、
 * appendLoglinesToFile に渡すことで、ファイル読み込みを初回のみに限定する。
 *
 * sync 操作完了後はキャッシュを破棄する（GCに任せる）。
 */
export type DedupCache = Map<string, Set<string>>;

/**
 * 重複判定キャッシュを作成する
 * sync 操作の開始時に1回呼び出し、appendLoglinesToFile に渡す。
 */
export const createDedupCache = (): DedupCache => new Map();

/**
 * ログ行をストレージファイルに追記
 * @param props.logLines 追記するログ行
 * @param props.logStoreFilePath 保存先ファイルパス（省略時は日付から自動決定）
 * @param props.dedupCache 重複判定キャッシュ（省略時は毎回ファイルを読み込む）
 * @returns 成功時はok、失敗時はerr
 */
export const appendLoglinesToFile = (props: {
  logLines: VRChatLogLine[];
  logStoreFilePath?: VRChatLogStoreFilePath;
  dedupCache?: DedupCache;
}): Effect.Effect<void, never> => {
  if (props.logLines.length === 0) {
    return Effect.succeed(undefined);
  }

  return Effect.gen(function* () {
    // ログを日付ごとにグループ化
    const logsByMonth = new Map<string, VRChatLogLine[]>();

    for (const logLine of props.logLines) {
      const dateMatch = logLine.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
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
      const date = datefns.parse(
        `${year}-${month}-01`,
        'yyyy-MM-dd',
        new Date(),
      );

      const monthDir = path.join(getLogStoreDir(), yearMonth);

      initLogStoreDir();

      if (!nodeFs.existsSync(monthDir)) {
        nodeFs.mkdirSync(monthDir, { recursive: true });
      }

      const logStoreFilePath = getLogStoreFilePathForDate(date);
      const isExists = fs.existsSyncSafe(logStoreFilePath.value);

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

          const newLog = `${logs.join('\n')}\n`;
          // writeFileSyncSafe returns Effect<void, WriteFileError>
          // Unexpected errors should propagate as defects
          yield* fs.writeFileSyncSafe(newFilePath, newLog).pipe(
            Effect.catchAll((e) => {
              throw e;
            }),
          );
          continue;
        }
      }

      // 既存のログ行をSetとして保持（キャッシュがあれば再利用）
      const cacheKey = logStoreFilePath.value;
      let existingLines: Set<string>;

      const cachedLines = props.dedupCache?.get(cacheKey);
      if (cachedLines) {
        existingLines = cachedLines;
      } else {
        existingLines = new Set<string>();
        let readSucceeded = true;

        if (isExists) {
          // readFileSyncSafe returns Effect<Buffer, ReadFileError>
          const readExit = yield* fs
            .readFileSyncSafe(logStoreFilePath.value)
            .pipe(Effect.either);
          if (readExit._tag === 'Right') {
            const content = readExit.right.toString();
            for (const line of content.split('\n')) {
              if (line) {
                existingLines.add(line);
              }
            }
          } else {
            readSucceeded = false;
            logger.warn(
              `Failed to read existing log file for dedup: ${logStoreFilePath.value}`,
            );
          }
        }
        // キャッシュに保存（読み込み成功時のみ。失敗時は次回リトライさせる）
        if (props.dedupCache && readSucceeded) {
          props.dedupCache.set(cacheKey, existingLines);
        }
      }

      // 重複を除外して新しいログ行を追加
      const newLines = logs.filter((log) => !existingLines.has(log));
      if (newLines.length === 0) {
        continue;
      }

      const newLog = `${newLines.join('\n')}\n`;

      // ファイルが存在しない場合は新規作成、存在する場合は追記
      if (!isExists) {
        yield* fs.writeFileSyncSafe(logStoreFilePath.value, newLog).pipe(
          Effect.catchAll((e) => {
            throw e;
          }),
        );
      } else {
        yield* fs.appendFileAsync(logStoreFilePath.value, newLog).pipe(
          Effect.catchAll((e) => {
            throw e;
          }),
        );
      }

      // キャッシュを更新（書き込み成功後に新しい行を追加）
      for (const line of newLines) {
        existingLines.add(line);
      }
    }
  }) as Effect.Effect<void, never>;
};
