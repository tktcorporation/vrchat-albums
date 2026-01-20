import * as crypto from 'node:crypto';
import type { Dirent } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';
import * as dateFns from 'date-fns';
import { xxhash128 } from 'hash-wasm';
import * as neverthrow from 'neverthrow';
import { ResultAsync } from 'neverthrow';
import * as path from 'pathe';
import sharp from 'sharp';
import { match, P } from 'ts-pattern';
import {
  type FolderDigest,
  FolderDigestSchema,
  type VRChatPhotoContainingFolderPath,
  VRChatPhotoContainingFolderPathSchema,
} from './../../lib/brandedTypes';
import { logger } from './../../lib/logger';
import {
  getGlobalMemoryMonitor,
  MEMORY_THRESHOLDS,
  MemoryMonitor,
  PARALLEL_LIMITS,
} from './../../lib/memoryMonitor';
import {
  clearSharpCache,
  initializeSharp,
  isSharpInitialized,
} from './../../lib/sharpConfig';
import * as fs from './../../lib/wrappedFs';
import { emitProgress } from '../initProgress/emitter';
import { getSettingStore, type PhotoFolderScanStates } from '../settingStore';
import * as model from './model/vrchatPhotoPath.model';
import {
  type VRChatPhotoDirPath,
  VRChatPhotoDirPathSchema,
} from './valueObjects';

// サムネイルキャッシュの設定
const THUMBNAIL_CACHE_DIR_NAME = 'vrchat-albums-thumbnails';
const MAX_CACHE_SIZE_MB = 500; // キャッシュの最大サイズ
const CACHE_CLEANUP_THRESHOLD = 0.9; // キャッシュサイズがこの割合を超えたらクリーンアップ
const CACHE_EXPIRY_DAYS = 7; // キャッシュの有効期限（日数）

// 書き込み中のキャッシュキーを追跡（競合防止）
const pendingCacheWrites = new Set<string>();

// キャッシュ書き込み失敗のトラッキング（サイレントエラー防止）
const CACHE_FAILURE_THRESHOLD = 10;
let consecutiveCacheFailures = 0;

/**
 * Electron app モジュールの安全なロード判定用
 *
 * テスト環境（Playwright、Vitest）では Electron モジュールが利用できないため、
 * try-catch でフォールバックする前に判定する。
 *
 * ## 注意
 * この関数は「環境による動作分岐」ではなく「Electron API の有無による安全なフォールバック」
 * のために使用する。ビジネスロジックの分岐には使用しないこと。
 *
 * @returns テスト環境（Electron が利用不可）の場合 true
 */
const isTestEnvironment = (): boolean => {
  return (
    process.env.PLAYWRIGHT_TEST === 'true' ||
    process.env.VITEST === 'true' ||
    process.env.NODE_ENV === 'test'
  );
};

/**
 * Electronのappモジュールを遅延取得する
 * Playwrightテスト時のクラッシュを防ぐため、トップレベルインポートを避ける
 *
 * ## 環境による動作の違い
 * - テスト環境: Electronを試行せずnullを返す（想定された動作）
 * - 開発/プロダクション環境: Electronのロードを試行し、失敗時はエラーログ出力
 *
 * @returns Electron appモジュール、または利用不可時はnull
 */
const getElectronApp = (): typeof import('electron').app | null => {
  // テスト環境ではElectronを試行しない（想定された動作）
  if (isTestEnvironment()) {
    logger.debug('Test environment detected, skipping Electron module');
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    return app;
  } catch (error) {
    // 開発/プロダクション環境でのElectronロード失敗は予期しない
    // Sentryに送信して問題を検知できるようにする
    if (process.env.NODE_ENV === 'production') {
      logger.error({
        message: 'Failed to load Electron app module in production environment',
        stack: error instanceof Error ? error : new Error(String(error)),
      });
    } else {
      // 開発環境では警告レベル（Electronなしでの動作確認時など）
      logger.warn({
        message: 'Electron app module not available, using fallback paths',
        stack: error instanceof Error ? error : new Error(String(error)),
      });
    }
    return null;
  }
};

/**
 * サムネイルキャッシュディレクトリのパスを取得
 */
const getThumbnailCacheDir = (): string => {
  const app = getElectronApp();
  if (app) {
    try {
      return path.join(app.getPath('temp'), THUMBNAIL_CACHE_DIR_NAME);
    } catch (error) {
      // アプリ未初期化時はフォールバック
      // 本番環境での調査が必要なためwarnレベルでログ出力
      logger.warn({
        message: 'app.getPath("temp") failed, using os.tmpdir() fallback',
        stack: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
  // テスト環境などでappが使えない場合
  return path.join(os.tmpdir(), THUMBNAIL_CACHE_DIR_NAME);
};

/**
 * キャッシュキーを生成（ファイルパスとサイズからハッシュを生成）
 */
const generateCacheKey = (photoPath: string, width?: number): string => {
  const normalizedPath = path.normalize(photoPath);
  const key = `${normalizedPath}:${width ?? 'original'}`;
  return crypto.createHash('md5').update(key).digest('hex');
};

/**
 * キャッシュディレクトリ初期化エラー
 */
interface CacheDirError {
  type: 'CACHE_DIR_CREATION_FAILED';
  message: string;
  code?: string;
}

/**
 * キャッシュディレクトリを初期化
 *
 * @returns ResultAsync<cacheDir, CacheDirError> - 成功時はディレクトリパス、失敗時はエラー
 */
const ensureCacheDir = (): neverthrow.ResultAsync<string, CacheDirError> => {
  const cacheDir = getThumbnailCacheDir();
  return neverthrow.ResultAsync.fromPromise(
    fsPromises.mkdir(cacheDir, { recursive: true }),
    (error) => {
      // ディレクトリが既に存在する場合は成功扱い（後でmapで処理）
      // それ以外はエラー
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'EEXIST') {
        // この分岐はResultAsync.fromPromiseでは直接okを返せないので、
        // エラーとして返し後でフィルタリング
        return {
          type: 'CACHE_DIR_CREATION_FAILED' as const,
          message: 'EEXIST',
          code: 'EEXIST',
        };
      }
      logger.error({
        message: `Failed to create cache directory: ${cacheDir}`,
        stack: error instanceof Error ? error : new Error(String(error)),
      });
      return {
        type: 'CACHE_DIR_CREATION_FAILED' as const,
        message: `Cannot create cache directory: ${cacheDir}`,
        code: nodeError.code,
      };
    },
  )
    .map(() => cacheDir)
    .orElse((error) => {
      // EEXIST の場合は成功として扱う
      if (error.code === 'EEXIST') {
        return neverthrow.ok(cacheDir);
      }
      return neverthrow.err(error);
    });
};

/**
 * キャッシュ読み取り結果の型
 *
 * キャッシュミスと予期しないエラーを区別するための discriminated union
 */
type CacheReadResult =
  | { status: 'hit'; data: Buffer }
  | {
      status: 'miss';
      reason: 'not_found' | 'expired' | 'cache_dir_unavailable';
    }
  | { status: 'error'; error: Error };

/**
 * キャッシュファイルのstat結果
 */
type CacheStatError =
  | { type: 'NOT_FOUND' }
  | { type: 'IO_ERROR'; error: Error };

/**
 * キャッシュファイルのstatを取得（ResultAsync版）
 */
const statCacheFile = (
  cachePath: string,
): neverthrow.ResultAsync<
  { stats: Awaited<ReturnType<typeof fsPromises.stat>>; cachePath: string },
  CacheStatError
> =>
  neverthrow.ResultAsync.fromPromise(
    fsPromises.stat(cachePath).then((stats) => ({ stats, cachePath })),
    (error): CacheStatError => {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return { type: 'NOT_FOUND' };
      }
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn({
        message: `Unexpected error reading cached thumbnail stat: ${cachePath}`,
        stack: err,
      });
      return { type: 'IO_ERROR', error: err };
    },
  );

/**
 * キャッシュファイルを読み込み（ResultAsync版）
 */
const readCacheFile = (
  cachePath: string,
): neverthrow.ResultAsync<Buffer, CacheStatError> =>
  neverthrow.ResultAsync.fromPromise(
    fsPromises.readFile(cachePath),
    (error): CacheStatError => {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return { type: 'NOT_FOUND' };
      }
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn({
        message: `Unexpected error reading cached thumbnail: ${cachePath}`,
        stack: err,
      });
      return { type: 'IO_ERROR', error: err };
    },
  );

/**
 * キャッシュからサムネイルを取得
 *
 * @param cacheKey キャッシュキー（generateCacheKeyで生成）
 * @returns 構造化された結果（hit/miss/error を区別可能）
 *
 * ## 戻り値の例
 * - { status: 'hit', data: Buffer } - キャッシュヒット
 * - { status: 'miss', reason: 'not_found' } - キャッシュファイルなし
 * - { status: 'miss', reason: 'expired' } - キャッシュ有効期限切れ
 * - { status: 'error', error: Error } - 予期しないエラー（権限、I/O等）
 */
const getCachedThumbnail = async (
  cacheKey: string,
): Promise<CacheReadResult> => {
  const cacheDirResult = await ensureCacheDir();
  if (cacheDirResult.isErr()) {
    // キャッシュディレクトリが利用不可の場合
    logger.debug({
      message: 'Cache directory unavailable, skipping cache lookup',
      stack: new Error(cacheDirResult.error.message),
    });
    return { status: 'miss', reason: 'cache_dir_unavailable' };
  }

  const cachePath = path.join(cacheDirResult.value, `${cacheKey}.webp`);

  // キャッシュファイルのstatを取得
  const statResult = await statCacheFile(cachePath);
  if (statResult.isErr()) {
    return match(statResult.error)
      .with({ type: 'NOT_FOUND' }, () => ({
        status: 'miss' as const,
        reason: 'not_found' as const,
      }))
      .with({ type: 'IO_ERROR' }, ({ error }) => ({
        status: 'error' as const,
        error,
      }))
      .exhaustive();
  }

  // キャッシュが有効期限を超えている場合は無効
  const { stats } = statResult.value;
  const cacheDate = new Date(Number(stats.mtimeMs));
  const expiryDate = dateFns.subDays(new Date(), CACHE_EXPIRY_DAYS);
  if (cacheDate < expiryDate) {
    return { status: 'miss', reason: 'expired' };
  }

  // キャッシュファイルを読み込み
  const readResult = await readCacheFile(cachePath);
  return readResult.match(
    (data) => ({ status: 'hit' as const, data }),
    (error) =>
      match(error)
        .with({ type: 'NOT_FOUND' }, () => ({
          status: 'miss' as const,
          reason: 'not_found' as const,
        }))
        .with({ type: 'IO_ERROR' }, ({ error: err }) => ({
          status: 'error' as const,
          error: err,
        }))
        .exhaustive(),
  );
};

/**
 * サムネイルをキャッシュに保存（アトミック書き込み + 競合防止）
 *
 * 複数の同時リクエストが同一キーに書き込もうとした場合:
 * - 最初のリクエストのみが書き込みを実行
 * - 後続のリクエストは早期リターン（既に書き込み中のため）
 *
 * アトミック書き込み:
 * - 一時ファイル (.tmp) に書き込み
 * - rename で本来のパスに移動
 * - これにより書き込み途中のファイルが読まれることを防止
 */
const saveThumbnailToCache = async (
  cacheKey: string,
  buffer: Buffer,
): Promise<void> => {
  // 既に書き込み中の場合はスキップ
  if (pendingCacheWrites.has(cacheKey)) {
    return;
  }
  pendingCacheWrites.add(cacheKey);

  try {
    const cacheDirResult = await ensureCacheDir();
    if (cacheDirResult.isErr()) {
      // キャッシュディレクトリが利用不可の場合は書き込みをスキップ
      logger.debug({
        message: 'Cache directory unavailable, skipping cache write',
        stack: new Error(cacheDirResult.error.message),
      });
      return;
    }

    const cachePath = path.join(cacheDirResult.value, `${cacheKey}.webp`);
    const tempPath = `${cachePath}.tmp`;

    // アトミック書き込み: tmp -> rename
    await fsPromises.writeFile(tempPath, buffer);
    await fsPromises.rename(tempPath, cachePath);

    // 書き込み成功: 連続失敗カウンターをリセット
    consecutiveCacheFailures = 0;
  } catch (error) {
    // 失敗カウントをインクリメント
    consecutiveCacheFailures++;

    logger.error({
      message: `Failed to save thumbnail to cache: ${cacheKey}`,
      stack: error instanceof Error ? error : new Error(String(error)),
    });

    // 連続失敗が閾値を超えた場合、ユーザーに通知できるレベルで警告
    if (consecutiveCacheFailures >= CACHE_FAILURE_THRESHOLD) {
      logger.warn({
        message: `Thumbnail cache has failed ${consecutiveCacheFailures} times consecutively. Cache may be unavailable (disk full, permission issues, etc.)`,
        details: {
          consecutiveFailures: consecutiveCacheFailures,
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
      // リセットしてログスパムを防ぐ
      consecutiveCacheFailures = 0;
    }
  } finally {
    pendingCacheWrites.delete(cacheKey);
  }
};

/**
 * キャッシュファイルのstat取得（クリーンアップ用）
 * ENOENT はレースコンディションで予期されるため、null を返す
 */
type CacheFileStatResult = {
  filePath: string;
  stats: Awaited<ReturnType<typeof fsPromises.stat>>;
  size: number;
  mtime: number;
} | null;

const statCacheFileForCleanup = (
  filePath: string,
): neverthrow.ResultAsync<CacheFileStatResult, never> =>
  neverthrow.ResultAsync.fromSafePromise(
    fsPromises
      .stat(filePath)
      .then(
        (stats): CacheFileStatResult => ({
          filePath,
          stats,
          size: Number(stats.size),
          mtime: Number(stats.mtimeMs),
        }),
      )
      .catch((error): null => {
        const nodeError = error as NodeJS.ErrnoException;
        // ENOENT はレースコンディション（ファイル削除）で予期される → null
        if (nodeError.code === 'ENOENT') {
          return null;
        }
        // その他のエラー（権限、I/O）はログ出力して null を返す
        // キャッシュクリーンアップは失敗しても致命的ではない
        logger.debug({
          message: `Failed to stat cache file: ${filePath}`,
          stack: error instanceof Error ? error : new Error(String(error)),
        });
        return null;
      }),
  );

/**
 * キャッシュファイル削除（クリーンアップ用）
 * 削除失敗は警告ログを出力して継続（致命的ではない）
 */
const unlinkCacheFile = (
  filePath: string,
): neverthrow.ResultAsync<boolean, never> =>
  neverthrow.ResultAsync.fromSafePromise(
    fsPromises
      .unlink(filePath)
      .then(() => true)
      .catch((error): false => {
        // 削除失敗をログ出力（処理は継続）
        logger.warn({
          message: `Failed to delete cache file during cleanup: ${filePath}`,
          stack: error instanceof Error ? error : new Error(String(error)),
        });
        return false;
      }),
  );

/**
 * キャッシュディレクトリの読み取りエラー
 */
type CacheReaddirError =
  | { type: 'PERMISSION_DENIED'; message: string }
  | { type: 'IO_ERROR'; message: string };

/**
 * キャッシュディレクトリを読み取る
 */
const readCacheDir = (
  cacheDir: string,
): neverthrow.ResultAsync<string[], CacheReaddirError> =>
  neverthrow.ResultAsync.fromPromise(
    fsPromises.readdir(cacheDir),
    (error): CacheReaddirError => {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'EACCES' || nodeError.code === 'EPERM') {
        return {
          type: 'PERMISSION_DENIED',
          message: `Permission denied reading cache directory: ${cacheDir}`,
        };
      }
      return {
        type: 'IO_ERROR',
        message: `Failed to read cache directory: ${nodeError.message}`,
      };
    },
  );

/**
 * 古いキャッシュをクリーンアップ（必要に応じて呼び出される）
 */
export const cleanupThumbnailCache = async (): Promise<void> => {
  const cacheDirResult = await ensureCacheDir();
  if (cacheDirResult.isErr()) {
    // キャッシュディレクトリが利用不可の場合はクリーンアップをスキップ
    logger.debug({
      message: 'Cache directory unavailable, skipping cleanup',
      stack: new Error(cacheDirResult.error.message),
    });
    return;
  }
  const cacheDir = cacheDirResult.value;

  const filesResult = await readCacheDir(cacheDir);
  if (filesResult.isErr()) {
    logger.error({
      message: 'Failed to cleanup thumbnail cache',
      stack: new Error(filesResult.error.message),
    });
    return;
  }

  const files = filesResult.value;
  const fileStats = await Promise.all(
    files.map((file) => {
      const filePath = path.join(cacheDir, file);
      return statCacheFileForCleanup(filePath).then((r) => r._unsafeUnwrap());
    }),
  );

  const validFiles = fileStats.filter(
    (f): f is NonNullable<CacheFileStatResult> => f !== null,
  );
  const totalSizeMB =
    validFiles.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024;

  // キャッシュサイズがしきい値を超えている場合のみクリーンアップ
  if (totalSizeMB < MAX_CACHE_SIZE_MB * CACHE_CLEANUP_THRESHOLD) {
    return;
  }

  logger.info(
    `Cleaning up thumbnail cache. Current size: ${totalSizeMB.toFixed(2)}MB`,
  );

  // 古いファイルから削除
  const sortedFiles = validFiles.sort((a, b) => a.mtime - b.mtime);
  let currentSize = totalSizeMB;
  const targetSize = MAX_CACHE_SIZE_MB * 0.5; // 50%まで削減

  for (const file of sortedFiles) {
    if (currentSize <= targetSize) {
      break;
    }
    const deleted = await unlinkCacheFile(file.filePath).then((r) =>
      r._unsafeUnwrap(),
    );
    if (deleted) {
      currentSize -= file.size / 1024 / 1024;
    }
  }

  logger.info(
    `Thumbnail cache cleanup completed. New size: ${currentSize.toFixed(2)}MB`,
  );
};

/**
 * VRChat の写真が保存されている場所のデフォルト値を取得する
 */
const getDefaultVRChatPhotoDir = (): VRChatPhotoDirPath => {
  let logFilesDir: string;

  if (process.platform === 'win32' && process.env.USERPROFILE) {
    const app = getElectronApp();
    const picturesPath = app?.getPath('pictures');
    // app.getPath('pictures') はフルパスを返す (例: C:\Users\xxx\Pictures)
    // フォールバック時は USERPROFILE/Pictures を使用
    logFilesDir = picturesPath
      ? path.join(picturesPath, 'VRChat')
      : path.join(process.env.USERPROFILE, 'Pictures', 'VRChat');
  } else {
    logFilesDir = path.join(process.env.HOME || '', 'Pictures', 'VRChat');
  }

  return VRChatPhotoDirPathSchema.parse(logFilesDir);
};

/**
 * VRChat の写真が保存されている場所を指定、保存する
 */
export const setVRChatPhotoDirPathToSettingStore = (
  photoDir: VRChatPhotoDirPath,
) => {
  const settingStore = getSettingStore();
  settingStore.setVRChatPhotoDir(photoDir.value);
};

/**
 * VRChat の写真が保存されている場所をクリアする
 */
export const clearVRChatPhotoDirPathInSettingStore = () => {
  const settingStore = getSettingStore();
  const result = settingStore.clearStoredSetting('vrchatPhotoDir');
  if (result.isErr()) {
    throw result.error;
  }
};

/**
 * VRChat の写真の保存場所を取得する
 * 指定された場所が保存されていない場合は、デフォルトの場所を返す
 */
export const getVRChatPhotoDirPath = (): VRChatPhotoDirPath => {
  // 写真の保存箇所を取得
  const photoDir = getDefaultVRChatPhotoDir();

  // 保存箇所が設定されている場合はそれを返す
  const settingStore = getSettingStore();
  const storedPhotoDir = settingStore.getVRChatPhotoDir();
  if (storedPhotoDir) {
    return VRChatPhotoDirPathSchema.parse(storedPhotoDir);
  }

  return photoDir;
};

// バッチサイズ定数
const PHOTO_METADATA_BATCH_SIZE = 100; // メタデータ取得用（sharp処理は重いため小さく）

/**
 * フォルダハッシュ計算エラー
 */
type FolderDigestError =
  | { type: 'FOLDER_NOT_FOUND'; folderPath: string }
  | { type: 'PERMISSION_DENIED'; folderPath: string };

/**
 * フォルダ内のVRChatファイル一覧からダイジェスト（ハッシュ）を計算
 * hash-wasmのxxhash128を使用してファイル名リストからハッシュを生成
 *
 * 注意: xxhash128は32文字のhexを出力し、既存のFolderDigestSchema（MD5形式）と互換
 *
 * @param folderPath VRChat写真を含むフォルダのパス
 * @returns ResultAsync<FolderDigest, FolderDigestError>
 *          - 成功時: FolderDigest（xxhash128ハッシュ値、32文字hex）
 *          - FOLDER_NOT_FOUND: スキャン中にフォルダが削除された（想定内）
 *          - PERMISSION_DENIED: 権限エラー（ユーザーに通知すべき）
 * @throws 予期しないエラー（EMFILE等）はSentry送信対象として再スロー
 */
const computeFolderDigest = (
  folderPath: VRChatPhotoContainingFolderPath,
): neverthrow.ResultAsync<FolderDigest, FolderDigestError> => {
  return neverthrow.ResultAsync.fromPromise(
    fsPromises.readdir(folderPath as string),
    (error): FolderDigestError => {
      const nodeError = error as NodeJS.ErrnoException;
      return match(nodeError.code)
        .with('ENOENT', () => {
          logger.debug(`Folder not found during hash: ${folderPath}`);
          return {
            type: 'FOLDER_NOT_FOUND' as const,
            folderPath: folderPath as string,
          };
        })
        .with(P.union('EACCES', 'EPERM'), () => {
          logger.warn({
            message: `Permission denied reading folder: ${folderPath}`,
            stack: error instanceof Error ? error : new Error(String(error)),
          });
          return {
            type: 'PERMISSION_DENIED' as const,
            folderPath: folderPath as string,
          };
        })
        .otherwise(() => {
          // 想定外エラー → Sentry送信のため再スロー
          throw error;
        });
    },
  ).andThen((files) => {
    // VRChat写真ファイルのみをフィルタリングしてソート
    const pngFiles = files
      .filter((f) => f.startsWith('VRChat_') && f.endsWith('.png'))
      .sort();

    // ファイル名リストをハッシュ化（ファイル内容は読まない）
    return neverthrow.ResultAsync.fromPromise(
      xxhash128(pngFiles.join('\n')),
      (error) => {
        // hash-wasmの内部エラーは想定外 → Sentry送信のため再スロー
        throw error;
      },
    ).andThen((hash) =>
      neverthrow.fromThrowable(
        () => FolderDigestSchema.parse(hash),
        (error): FolderDigestError => {
          // xxhash128が予期しないハッシュ形式を返した場合
          // これはライブラリのバグまたは破壊的変更を示すため、Sentryに送信
          logger.error({
            message: 'Invalid hash format from hash-wasm library',
            stack: error instanceof Error ? error : new Error(String(error)),
            details: { hash, folderPath: folderPath as string },
          });
          throw error;
        },
      )(),
    );
  });
};

/**
 * VRChat写真を含むフォルダを全て探索（再帰的）
 * ユーザーが独自のフォルダ分けをしている場合にも対応
 *
 * @param basePath ユーザー設定のベースディレクトリ
 * @returns VRChat写真を含むフォルダパスの配列（ブランド型）
 */
const getPhotoFolders = async (
  basePath: VRChatPhotoDirPath,
): Promise<VRChatPhotoContainingFolderPath[]> => {
  const photoFolders: string[] = [];

  const scanDir = async (dirPath: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      // エラーを分類して適切に処理
      match(nodeError.code)
        .with('ENOENT', () => {
          // ディレクトリが存在しない（スキャン中に削除された等）→ 想定内
          logger.debug(`Directory not found: ${dirPath}`);
        })
        .with(P.union('EACCES', 'EPERM'), () => {
          // 権限エラー → ユーザーに通知すべき警告
          logger.warn({
            message: `Permission denied reading directory: ${dirPath}. Check folder permissions.`,
            stack: error instanceof Error ? error : new Error(String(error)),
          });
        })
        .otherwise(() => {
          // 想定外エラー → Sentry送信のため再スロー
          throw error;
        });
      return;
    }

    // VRChat写真があるかチェック
    const hasVRChatPhotos = entries.some(
      (e) =>
        e.isFile() && e.name.startsWith('VRChat_') && e.name.endsWith('.png'),
    );

    // Simple boolean check → if文が適切（CLAUDE.md例外）
    if (hasVRChatPhotos) {
      photoFolders.push(dirPath);
    }

    // サブディレクトリを再帰探索（async/await制御のためif文を使用）
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await scanDir(path.join(dirPath, entry.name));
      }
    }
  };

  await scanDir(basePath.value);
  // 発見したフォルダパスをブランド型に変換
  return photoFolders.map((p) =>
    VRChatPhotoContainingFolderPathSchema.parse(p),
  );
};

/**
 * Stage 1: フォルダダイジェストチェック
 * 変更があったフォルダとそのファイル一覧を返す
 */
interface ChangedFolder {
  folderPath: VRChatPhotoContainingFolderPath;
  fileNames: string[];
  currentDigest: FolderDigest;
}

/**
 * スキップされたフォルダの統計情報
 */
interface SkipStatistics {
  digestErrors: {
    folderNotFound: number;
    permissionDenied: number;
  };
  readdirErrors: {
    folderNotFound: number;
    permissionDenied: number;
  };
  statErrors: {
    fileNotFound: number;
    permissionDenied: number;
  };
}

/**
 * getChangedFoldersWithFiles の戻り値
 */
interface ChangedFoldersResult {
  changedFolders: ChangedFolder[];
  skipStats: SkipStatistics;
}

const getChangedFoldersWithFiles = async (
  basePath: VRChatPhotoDirPath,
  savedStates: PhotoFolderScanStates,
): Promise<ChangedFoldersResult> => {
  // VRChat写真を含むフォルダを全て探索（再帰的）
  const folders = await getPhotoFolders(basePath);
  const changedFolders: ChangedFolder[] = [];
  const skipStats: SkipStatistics = {
    digestErrors: { folderNotFound: 0, permissionDenied: 0 },
    readdirErrors: { folderNotFound: 0, permissionDenied: 0 },
    statErrors: { fileNotFound: 0, permissionDenied: 0 },
  };

  for (const folderPath of folders) {
    // hash-wasm でダイジェスト計算（エラー時はスキップ）
    const digestResult = await computeFolderDigest(folderPath);

    if (digestResult.isErr()) {
      // FOLDER_NOT_FOUND/PERMISSION_DENIED はログ済み、統計を記録してスキップ
      match(digestResult.error.type)
        .with('FOLDER_NOT_FOUND', () => {
          skipStats.digestErrors.folderNotFound++;
        })
        .with('PERMISSION_DENIED', () => {
          skipStats.digestErrors.permissionDenied++;
        })
        .exhaustive();
      continue;
    }

    const currentDigest = digestResult.value;

    // ブランド型から生のstring値を取得して比較（オブジェクトキーアクセス用）
    const savedState = savedStates[folderPath as string];

    // デバッグ: savedState lookup 結果
    logger.debug(
      `[DigestCheck] folder=${folderPath}, savedStateExists=${!!savedState}, savedDigest=${savedState?.digest ?? 'none'}, currentDigest=${currentDigest}`,
    );

    // ダイジェストが一致すればスキップ（FolderDigest同士は直接比較可能）
    if (savedState && savedState.digest === currentDigest) {
      logger.debug(`[DigestCheck] MATCH - skipping folder: ${folderPath}`);
      continue;
    }
    logger.debug(
      `[DigestCheck] MISMATCH - folder will be processed: ${folderPath}`,
    );

    // 変更があったフォルダのファイル一覧を取得（エラー時はスキップ）
    const fileNamesResult = await neverthrow.ResultAsync.fromPromise(
      fsPromises.readdir(folderPath as string),
      (error): { type: 'READDIR_ERROR'; code: string | undefined } => {
        const nodeError = error as NodeJS.ErrnoException;
        return match(nodeError.code)
          .with('ENOENT', () => {
            logger.debug(`Folder deleted during scan: ${folderPath}`);
            return { type: 'READDIR_ERROR' as const, code: nodeError.code };
          })
          .with(P.union('EACCES', 'EPERM'), () => {
            logger.warn({
              message: `Permission denied reading folder: ${folderPath}`,
              stack: error instanceof Error ? error : new Error(String(error)),
            });
            return { type: 'READDIR_ERROR' as const, code: nodeError.code };
          })
          .otherwise(() => {
            // 想定外エラー → Sentry送信のため再スロー
            throw error;
          });
      },
    );

    if (fileNamesResult.isErr()) {
      // 統計を記録してスキップ
      match(fileNamesResult.error.code)
        .with('ENOENT', () => {
          skipStats.readdirErrors.folderNotFound++;
        })
        .with(P.union('EACCES', 'EPERM'), () => {
          skipStats.readdirErrors.permissionDenied++;
        })
        .otherwise((code) => {
          // 上記のreaddirエラーマッパーで想定外エラーはre-throwされるため、
          // このブランチは到達不能のはず。到達した場合は調査が必要
          logger.warn({
            message:
              'Unexpected readdir error code reached statistics tracking',
            details: { code },
          });
        });
      continue;
    }

    const fileNames = fileNamesResult.value;

    logger.debug(
      `Folder changed: ${folderPath} (saved: ${savedState?.digest ?? 'none'}, current: ${currentDigest})`,
    );
    changedFolders.push({ folderPath, fileNames, currentDigest });
  }

  return { changedFolders, skipStats };
};

/**
 * filterNewFilesByMtime の戻り値
 */
interface FilterMtimeResult {
  newFiles: string[];
  statErrors: {
    fileNotFound: number;
    permissionDenied: number;
  };
}

/**
 * Stage 2: ファイルmtimeチェック
 * 変更フォルダ内のファイルをmtimeでフィルタし、新規/更新ファイルのパスを返す
 */
const filterNewFilesByMtime = async (
  changedFolder: ChangedFolder,
  lastScannedAt: Date | null,
): Promise<FilterMtimeResult> => {
  const { folderPath, fileNames } = changedFolder;
  // ブランド型をstringにキャストしてpath.joinに渡す
  const folderPathStr = folderPath as string;
  const newFiles: string[] = [];
  const statErrors = { fileNotFound: 0, permissionDenied: 0 };

  for (const fileName of fileNames) {
    // VRChat写真のみ対象
    if (!fileName.startsWith('VRChat_') || !fileName.endsWith('.png')) {
      continue;
    }

    const filePath = path.join(folderPathStr, fileName);

    // 前回スキャン日時がなければ全件対象
    if (!lastScannedAt) {
      newFiles.push(filePath);
      continue;
    }

    // ファイルのmtimeを取得
    const statsResult = await neverthrow.ResultAsync.fromPromise(
      fsPromises.stat(filePath),
      (
        error,
      ): { type: 'FILE_NOT_FOUND' | 'PERMISSION_DENIED'; message: string } => {
        const nodeError = error as NodeJS.ErrnoException;
        return match(nodeError.code)
          .with('ENOENT', () => {
            // スキャン中にファイルが削除された → 想定内
            logger.debug(`File not found (deleted during scan): ${filePath}`);
            return {
              type: 'FILE_NOT_FOUND' as const,
              message: 'File not found',
            };
          })
          .with(P.union('EACCES', 'EPERM'), () => {
            // 権限エラー → ユーザーに通知すべき
            logger.warn({
              message: `Permission denied accessing file: ${filePath}`,
              stack: error instanceof Error ? error : new Error(String(error)),
            });
            return {
              type: 'PERMISSION_DENIED' as const,
              message: nodeError.message ?? 'Permission denied',
            };
          })
          .otherwise(() => {
            // 想定外エラー → Sentry送信のため再スロー
            throw error;
          });
      },
    );

    if (statsResult.isErr()) {
      // エラー種別に応じて統計を更新
      match(statsResult.error.type)
        .with('FILE_NOT_FOUND', () => {
          statErrors.fileNotFound++;
        })
        .with('PERMISSION_DENIED', () => {
          statErrors.permissionDenied++;
        })
        .exhaustive();
      continue;
    }

    // mtime > lastScannedAt なら新規/更新ファイル
    if (statsResult.value.mtime > lastScannedAt) {
      newFiles.push(filePath);
    }
  }

  return { newFiles, statErrors };
};

/**
 * 写真情報のバッチを処理する
 * メモリ効率を考慮し、並列処理数を制限
 *
 * ## メモリ最適化
 * - 並列数を5に制限（libvipsのネイティブメモリ使用を抑制）
 * - RSS監視で圧迫時に遅延
 * - サブバッチ間でSharpキャッシュをクリア
 */
async function processPhotoBatch(
  photoPaths: string[],
  memoryMonitor?: MemoryMonitor,
): Promise<
  Array<{ photoPath: string; takenAt: Date; width: number; height: number }>
> {
  const results: Array<{
    photoPath: string;
    takenAt: Date;
    width: number;
    height: number;
  }> = [];

  // 並列処理数をメモリ使用量に基づいて動的に決定
  const monitor = memoryMonitor ?? getGlobalMemoryMonitor();
  const parallelLimit = monitor.getRecommendedParallelLimit(
    PARALLEL_LIMITS.sharpMetadata,
  );

  for (let i = 0; i < photoPaths.length; i += parallelLimit) {
    const subBatch = photoPaths.slice(i, i + parallelLimit);

    // メモリ監視
    await monitor.checkMemory(
      `processPhotoBatch subBatch ${Math.floor(i / parallelLimit) + 1}`,
    );

    const photoInfoPromises = subBatch.map(async (photoPath) => {
      const matchResult = photoPath.match(
        /VRChat_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3})/,
      );
      if (!matchResult) {
        // VRChat写真のファイル名パターンにマッチしない場合
        // これは通常発生しないが、ファイル名が破損している可能性がある
        logger.debug({
          message: 'Photo filename did not match expected pattern, skipping',
          details: { photoPath },
        });
        return null;
      }

      const takenAt = dateFns.parse(
        matchResult[1],
        'yyyy-MM-dd_HH-mm-ss.SSS',
        new Date(),
      );

      // sharpインスタンスを使い捨てにしてメモリリークを防ぐ
      const metadataResult = await neverthrow.ResultAsync.fromPromise(
        sharp(photoPath).metadata(),
        (error): { type: 'SHARP_ERROR'; message: string } => {
          const nodeError = error as NodeJS.ErrnoException;
          return match(nodeError.code)
            .with('ENOENT', () => {
              // ファイル削除はレースコンディションで想定される
              logger.debug(
                `Photo file not found during metadata extraction: ${photoPath}`,
              );
              return {
                type: 'SHARP_ERROR' as const,
                message: 'File not found',
              };
            })
            .with(P.union('EACCES', 'EPERM'), () => {
              // 権限エラー → ユーザーに通知すべき
              logger.warn({
                message: `Permission denied reading photo: ${photoPath}`,
                stack:
                  error instanceof Error ? error : new Error(String(error)),
              });
              return {
                type: 'SHARP_ERROR' as const,
                message: nodeError.message ?? 'Permission denied',
              };
            })
            .otherwise(() => {
              // sharpの内部エラー、破損ファイル等 → Sentry送信のため再スロー
              // デバッグのためファイルパス情報を付加
              const contextualError = new Error(
                `Sharp processing failed for: ${photoPath}`,
                { cause: error },
              );
              throw contextualError;
            });
        },
      );

      if (metadataResult.isErr()) {
        return null;
      }

      const metadata = metadataResult.value;
      const height = metadata.height ?? 720;
      const width = metadata.width ?? 1280;

      // メタデータが不完全な場合は警告ログを出力（デバッグ用）
      if (!metadata.height || !metadata.width) {
        logger.warn({
          message: `Missing dimension metadata for photo, using defaults`,
          details: {
            photoPath,
            hasHeight: !!metadata.height,
            hasWidth: !!metadata.width,
            defaultsUsed: { height, width },
          },
        });
      }

      return {
        photoPath,
        takenAt,
        width,
        height,
      };
    });

    const subResults = (await Promise.all(photoInfoPromises)).filter(
      (
        info,
      ): info is {
        photoPath: string;
        takenAt: Date;
        width: number;
        height: number;
      } => info !== null,
    );

    results.push(...subResults);

    // サブバッチ処理後にSharpキャッシュをクリア（メモリ解放）
    // 大量処理時のメモリ蓄積を防ぐ
    if (photoPaths.length > PHOTO_METADATA_BATCH_SIZE) {
      clearSharpCache();
    }
  }

  return results;
}

/**
 * 写真ディレクトリを走査してインデックスを更新する
 * logSync などから呼び出される
 *
 * ## 3段階フィルタリング
 * - Stage 1: フォルダダイジェストチェック（変更がないフォルダをスキップ）
 * - Stage 2: ファイルmtimeチェック（変更フォルダ内の新規ファイルを抽出）
 * - Stage 3: sharp処理 + DB保存
 *
 * ## メモリ最適化
 * - 初回/フルスキャン時は低メモリモードでSharpを初期化
 * - RSS監視で圧迫時に自動遅延
 * - バッチ間でSharpキャッシュをクリア
 *
 * @param isIncremental true: 差分スキャン（ダイジェスト・mtime使用）、false: フルスキャン
 */
export const createVRChatPhotoPathIndex = async (isIncremental = true) => {
  const startTime = performance.now();
  const targetDir = getVRChatPhotoDirPath();
  const settingStore = getSettingStore();
  const extraDirs = settingStore.getVRChatPhotoExtraDirList();

  // Sharp 初期化（未初期化の場合のみ）
  if (!isSharpInitialized()) {
    initializeSharp();
  }

  // メモリ監視を初期化
  const memoryMonitor = new MemoryMonitor({
    rssWarningThresholdMB: MEMORY_THRESHOLDS.warningMB,
    rssCriticalThresholdMB: MEMORY_THRESHOLDS.criticalMB,
    throttleDelayMs: 100,
    enableLogging: true,
  });

  const allDirs = [targetDir, ...extraDirs];
  let totalProcessed = 0;
  let batchNumber = 0;
  const allCreatedModels: model.VRChatPhotoPathModel[] = [];

  // スキップ統計の集計用
  const totalSkipStats: SkipStatistics = {
    digestErrors: { folderNotFound: 0, permissionDenied: 0 },
    readdirErrors: { folderNotFound: 0, permissionDenied: 0 },
    statErrors: { fileNotFound: 0, permissionDenied: 0 },
  };

  // フォルダスキャン状態を取得（差分スキャン用）
  const savedStates = isIncremental
    ? settingStore.getPhotoFolderScanStates()
    : {};
  const updatedStates: PhotoFolderScanStates = { ...savedStates };

  logger.info(
    `Starting photo index creation with ${allDirs.length} directories (mode: ${isIncremental ? 'incremental' : 'full'})`,
  );

  try {
    // 各ディレクトリを順番に処理
    for (const dir of allDirs) {
      logger.debug(`Processing photos from directory: ${dir.value}`);

      // Stage 1: フォルダダイジェストチェック
      const { changedFolders, skipStats } = await getChangedFoldersWithFiles(
        dir,
        savedStates,
      );

      // スキップ統計を集計
      totalSkipStats.digestErrors.folderNotFound +=
        skipStats.digestErrors.folderNotFound;
      totalSkipStats.digestErrors.permissionDenied +=
        skipStats.digestErrors.permissionDenied;
      totalSkipStats.readdirErrors.folderNotFound +=
        skipStats.readdirErrors.folderNotFound;
      totalSkipStats.readdirErrors.permissionDenied +=
        skipStats.readdirErrors.permissionDenied;

      if (changedFolders.length === 0) {
        logger.debug(`No changed folders in: ${dir.value}`);
        continue;
      }

      logger.debug(
        `Found ${changedFolders.length} changed folders in: ${dir.value}`,
      );

      // 各変更フォルダを処理
      for (const changedFolder of changedFolders) {
        // ブランド型をstringにキャストしてストレージアクセス（パスのみ）
        const folderPathStr = changedFolder.folderPath as string;
        // digestはFolderDigest型のまま保持（FolderScanStateSchema.digestと型統一）
        const { currentDigest } = changedFolder;

        const savedState = savedStates[folderPathStr];
        const lastScannedAt = savedState
          ? new Date(savedState.lastScannedAt)
          : null;

        // Stage 2: ファイルmtimeチェック
        const { newFiles, statErrors } = await filterNewFilesByMtime(
          changedFolder,
          lastScannedAt,
        );

        // デバッグ: mtime フィルタ結果
        logger.debug(
          `[MtimeFilter] folder=${folderPathStr}, lastScannedAt=${lastScannedAt?.toISOString() ?? 'null'}, totalFiles=${changedFolder.fileNames.length}, newFiles=${newFiles.length}`,
        );

        // stat統計を集計
        totalSkipStats.statErrors.fileNotFound += statErrors.fileNotFound;
        totalSkipStats.statErrors.permissionDenied +=
          statErrors.permissionDenied;

        if (newFiles.length === 0) {
          // ファイル削除のみの場合など（ダイジェスト変更だがmtimeでフィルタ後0件）
          // ダイジェストは更新する
          updatedStates[folderPathStr] = {
            digest: currentDigest,
            lastScannedAt: new Date().toISOString(),
          };
          continue;
        }

        logger.debug(
          `Found ${newFiles.length} new files in: ${changedFolder.folderPath}`,
        );

        // Stage 3: バッチ処理（sharp + DB保存）
        for (let i = 0; i < newFiles.length; i += PHOTO_METADATA_BATCH_SIZE) {
          const batch = newFiles.slice(i, i + PHOTO_METADATA_BATCH_SIZE);
          batchNumber++;

          // バッチ処理前にメモリをチェック
          await memoryMonitor.checkMemory(`batch ${batchNumber} start`);

          const batchStartTime = performance.now();
          const processedBatch = await processPhotoBatch(batch, memoryMonitor);

          if (processedBatch.length > 0) {
            const dbStartTime = performance.now();
            // DBエラーは予期しないエラーとしてSentryに送信
            // batch情報をログに記録してから再スロー
            let createdModels: model.VRChatPhotoPathModel[];
            try {
              createdModels = await model.createOrUpdateListVRChatPhotoPath(
                processedBatch.map((photo) => ({
                  photoPath: photo.photoPath,
                  photoTakenAt: photo.takenAt,
                  width: photo.width,
                  height: photo.height,
                })),
              );
            } catch (dbError) {
              logger.error({
                message: `Database error saving photo batch ${batchNumber}`,
                stack:
                  dbError instanceof Error
                    ? dbError
                    : new Error(String(dbError)),
                details: {
                  batchNumber,
                  batchSize: processedBatch.length,
                  folderPath: folderPathStr,
                  firstPhotoPath: processedBatch[0]?.photoPath,
                },
              });
              throw dbError;
            }
            const dbEndTime = performance.now();

            allCreatedModels.push(...createdModels);
            totalProcessed += processedBatch.length;

            // 途中経過を報告（総数不明のため中間値を使用）
            emitProgress({
              stage: 'photo_index',
              progress: 50,
              message: `写真をインデックス中... (${totalProcessed} 件処理済み)`,
            });

            const batchEndTime = performance.now();
            logger.debug(
              `Batch ${batchNumber}: Processed ${processedBatch.length} photos in ${(batchEndTime - batchStartTime).toFixed(2)} ms (metadata: ${(dbStartTime - batchStartTime).toFixed(2)} ms, DB: ${(dbEndTime - dbStartTime).toFixed(2)} ms)`,
            );
          }

          // バッチ処理後にSharpキャッシュをクリア（メモリ解放）
          clearSharpCache();
        }

        // フォルダスキャン状態を更新
        updatedStates[folderPathStr] = {
          digest: currentDigest,
          lastScannedAt: new Date().toISOString(),
        };
      }
    }
  } finally {
    // エラー発生時も途中経過を保存（次回スキャンで未処理分が再処理される）
    // このtry-catchはオリジナルエラーを隠さないために内部で処理
    try {
      settingStore.setPhotoFolderScanStates(updatedStates);
    } catch (stateError) {
      logger.error({
        message: 'Failed to persist photo folder scan states',
        stack:
          stateError instanceof Error
            ? stateError
            : new Error(String(stateError)),
      });
      // オリジナルエラーが伝播するようにここではre-throwしない
    }
  }

  const totalEndTime = performance.now();

  // スキップされたフォルダ/ファイルがあれば警告ログを出力
  const totalFolderSkipped =
    totalSkipStats.digestErrors.folderNotFound +
    totalSkipStats.digestErrors.permissionDenied +
    totalSkipStats.readdirErrors.folderNotFound +
    totalSkipStats.readdirErrors.permissionDenied;

  const totalFileSkipped =
    totalSkipStats.statErrors.fileNotFound +
    totalSkipStats.statErrors.permissionDenied;

  if (totalFolderSkipped > 0 || totalFileSkipped > 0) {
    logger.warn({
      message: `Photo scan skipped items due to errors: ${totalFolderSkipped} folders, ${totalFileSkipped} files`,
      details: {
        digestErrors: {
          folderNotFound: totalSkipStats.digestErrors.folderNotFound,
          permissionDenied: totalSkipStats.digestErrors.permissionDenied,
        },
        readdirErrors: {
          folderNotFound: totalSkipStats.readdirErrors.folderNotFound,
          permissionDenied: totalSkipStats.readdirErrors.permissionDenied,
        },
        statErrors: {
          fileNotFound: totalSkipStats.statErrors.fileNotFound,
          permissionDenied: totalSkipStats.statErrors.permissionDenied,
        },
      },
    });
  }

  if (totalProcessed === 0) {
    logger.debug('No new photos found to index.');
    return [];
  }

  // メモリ使用状況のサマリーをログ出力
  memoryMonitor.logSummary('createVRChatPhotoPathIndex');

  logger.info(
    `Photo index creation completed: ${totalProcessed} photos processed in ${(totalEndTime - startTime).toFixed(2)} ms (${batchNumber} batches, peak RSS: ${memoryMonitor.getPeakRssMB().toFixed(0)}MB)`,
  );

  return allCreatedModels;
};

/**
 * 写真パスモデルを条件付きで取得する
 * コントローラー経由で一覧表示に利用される
 * ページネーション対応でメモリ使用量を抑える
 */
export const getVRChatPhotoPathList = async (query?: {
  gtPhotoTakenAt?: Date;
  ltPhotoTakenAt?: Date;
  orderByPhotoTakenAt: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}) => {
  return model.getVRChatPhotoPathList(query);
};

/**
 * 写真の総件数を取得する（ページネーション用）
 */
export const getVRChatPhotoPathCount = async (query?: {
  gtPhotoTakenAt?: Date;
  ltPhotoTakenAt?: Date;
}) => {
  return model.getVRChatPhotoPathCount(query);
};

/**
 * 月別の写真枚数を取得する
 * 統計情報としてフロントエンドへ返す
 */
export const getCountByYearMonthList = async () => {
  return model.getCountByYearMonthList();
};

/**
 * VRChat の写真のパスが有効かどうかを検証する
 * 無効な場合は削除する
 */
export const validateVRChatPhotoPathModel = async ({
  fullpath,
}: {
  fullpath: string;
}): Promise<'MODEL_NOT_FOUND' | 'VALID' | 'FILE_NOT_FOUND_MODEL_DELETED'> => {
  const pathModel = await model.getVRChatPhotoPathByPhotoPath(fullpath);
  if (!pathModel) {
    return 'MODEL_NOT_FOUND';
  }
  if (!fs.existsSyncSafe(pathModel.photoPath)) {
    await model.deleteVRChatPhotoPathModel(pathModel);
    return 'FILE_NOT_FOUND_MODEL_DELETED';
  }
  return 'VALID';
};

/**
 * 画像ファイルを読み込み Base64 文字列で返す
 * テストやプレビュー生成で利用される
 *
 * メモリ効率のため、サムネイルはディスクキャッシュを使用:
 * - width指定時: WebP形式でキャッシュし、再利用
 * - 元サイズ時: キャッシュなし（大きすぎるため）
 */
export const getVRChatPhotoItemData = async ({
  photoPath,
  width,
}: {
  photoPath: string;
  // 指定しない場合は元画像のサイズをそのまま返す
  width?: number;
}): Promise<neverthrow.Result<string, 'InputFileIsMissing'>> => {
  // ResultAsync.fromPromise で予期されたエラー (InputFileIsMissing) を処理
  return ResultAsync.fromPromise(
    (async () => {
      // サムネイル（width指定あり）の場合はキャッシュを使用
      if (width !== undefined) {
        const cacheKey = generateCacheKey(photoPath, width);

        // キャッシュから取得を試みる（構造化された結果で判定）
        const cacheResult = await getCachedThumbnail(cacheKey);

        // ts-patternでキャッシュ結果を処理
        const cachedData = match(cacheResult)
          .with({ status: 'hit' }, ({ data }) => data)
          .with({ status: 'miss' }, () => null)
          .with({ status: 'error' }, ({ error }) => {
            // エラー時はログ出力済み、生成にフォールバック
            logger.debug({
              message: `Cache read error for ${cacheKey}, regenerating thumbnail`,
              stack: error,
            });
            return null;
          })
          .exhaustive();

        if (cachedData) {
          return `data:image/webp;base64,${cachedData.toString('base64')}`;
        }

        // キャッシュにない場合は生成してキャッシュに保存
        const photoBuf = await sharp(photoPath)
          .resize(width)
          .webp({ quality: 80 }) // WebPに変換（ファイルサイズ削減）
          .toBuffer();

        // 非同期でキャッシュに保存（レスポンスを遅らせない）
        // エラーは saveThumbnailToCache 内部でログ出力される
        void saveThumbnailToCache(cacheKey, photoBuf);

        return `data:image/webp;base64,${photoBuf.toString('base64')}`;
      }

      // 元サイズの場合はキャッシュなし
      const photoBuf = await sharp(photoPath).toBuffer();
      return `data:image/${path
        .extname(photoPath)
        .replace('.', '')};base64,${photoBuf.toString('base64')}`;
    })(),
    (error): 'InputFileIsMissing' => {
      return match(error)
        .with(
          P.intersection(P.instanceOf(Error), {
            message: P.string.includes('Input file is missing'),
          }),
          () => 'InputFileIsMissing' as const,
        )
        .otherwise((e) => {
          // 予期しないエラーはre-throw（Sentryに送信）
          throw e instanceof Error ? e : new Error(JSON.stringify(e));
        });
    },
  );
};

/**
 * データベース内で最新の写真日時を取得する
 * ログ同期の開始位置判定に用いる
 */
export const getLatestPhotoDate = async (): Promise<Date | null> => {
  const latestPhoto = await model.getLatestVRChatPhoto();
  return latestPhoto?.photoTakenAt ?? null;
};

/**
 * 軽量メタデータのみ取得する（初回クエリ用）
 * photoPath を含まないことでメモリ使用量を大幅に削減
 *
 * 使用例:
 * - 写真10万枚の場合、通常取得: ~19.3MB → 軽量取得: ~5MB (約74%削減)
 */
export const getVRChatPhotoMetadataList = async (query?: {
  gtPhotoTakenAt?: Date;
  ltPhotoTakenAt?: Date;
  orderByPhotoTakenAt: 'asc' | 'desc';
}) => {
  return model.getVRChatPhotoMetadataList(query);
};

/**
 * 指定されたIDの写真パスをオンデマンドでバッチ取得
 * 表示に必要な範囲のみ取得することでメモリ使用量を削減
 *
 * @param ids 取得したい写真のIDリスト
 * @returns Map<id, photoPath>
 */
export const getVRChatPhotoPathsByIds = async (ids: string[]) => {
  return model.getVRChatPhotoPathsByIds(ids);
};

/**
 * バッチサムネイル取得の結果
 */
export interface BatchThumbnailResult {
  /** 成功したサムネイル（photoPath -> base64Data） */
  success: Map<string, string>;
  /** 失敗したパスと理由 */
  failed: Array<{
    photoPath: string;
    reason: 'file_not_found' | 'unexpected_error';
    message: string;
  }>;
}

/**
 * 複数のサムネイルをバッチ取得（Google Photos風の高速ローディング）
 *
 * 個別リクエストではなくバッチで取得することで:
 * - ネットワークオーバーヘッド削減
 * - 並列処理による高速化
 *
 * @param photoPaths 取得したい写真のパスリスト
 * @param width サムネイルの幅（デフォルト: 256px）
 * @returns 成功したサムネイルと失敗情報を含む構造化された結果
 */
export const getBatchThumbnails = async (
  photoPaths: string[],
  width = 256,
): Promise<BatchThumbnailResult> => {
  const success = new Map<string, string>();
  const failed: BatchThumbnailResult['failed'] = [];

  // 並列処理数をメモリ使用量に基づいて動的に決定
  const monitor = getGlobalMemoryMonitor();
  const thumbnailParallelLimit = monitor.getRecommendedParallelLimit(
    PARALLEL_LIMITS.thumbnail,
  );

  for (let i = 0; i < photoPaths.length; i += thumbnailParallelLimit) {
    const batch = photoPaths.slice(i, i + thumbnailParallelLimit);

    const thumbnailPromises = batch.map(async (photoPath) => {
      // getVRChatPhotoItemData は予期しないエラーを throw するため
      // エラーをキャッチして photoPath と共に返す
      try {
        const result = await getVRChatPhotoItemData({ photoPath, width });
        return { photoPath, result, unexpectedError: null as Error | null };
      } catch (error) {
        // 予期しないエラー（sharp内部エラー等）はここでキャッチ
        return {
          photoPath,
          result: null,
          unexpectedError:
            error instanceof Error ? error : new Error(String(error)),
        };
      }
    });

    // 全てのPromiseが成功するため Promise.all を使用
    const results = await Promise.all(thumbnailPromises);

    for (const item of results) {
      if (item.unexpectedError) {
        // 予期しないエラー（sharp内部エラー等）をログ出力
        // Sentryに送信されるのは logger.error() 経由
        logger.error({
          message: 'Unexpected error during batch thumbnail fetch',
          stack: item.unexpectedError,
          details: { photoPath: item.photoPath },
        });
        failed.push({
          photoPath: item.photoPath,
          reason: 'unexpected_error',
          message: item.unexpectedError.message,
        });
      } else if (item.result) {
        item.result.match(
          (data) => success.set(item.photoPath, data),
          (error) =>
            failed.push({
              photoPath: item.photoPath,
              reason: 'file_not_found',
              message: error,
            }),
        );
      }
    }
  }

  // 失敗があった場合はサマリーログを出力
  if (failed.length > 0) {
    logger.info({
      message: `Batch thumbnail fetch completed with failures`,
      details: {
        totalRequested: photoPaths.length,
        successCount: success.size,
        failedCount: failed.length,
      },
    });
  }

  return { success, failed };
};
