/**
 * 処理本体（utilityProcess）の入口。main プロセスが `utilityProcess.fork` で `main/backend.cjs` として起動する。
 *
 * tRPC の router・サービス・DB・worker・設定ファイルの書き込み・バックグラウンド同期のタイマーをここで動かす。
 * Electron の `app`・`dialog`・`shell`・ウィンドウはこのプロセスに無いので、OS の操作は殻（`getHost()`）を通して
 * main へ頼む（`electron/lib/hostRpc/`）。main との取り決めは `electron/lib/backendProcess/protocol.ts` にある。
 *
 * 起動の順序:
 * 1. main から `init`（パス・版などの殻の情報）を受け取るまで何もしない
 * 2. ログの保存先とエラー監視を整え、殻を登録する
 * 3. 設定ストアと DB を開き、router を読み込む。router のモジュールは読み込み時に `getHost()` を使うので、
 *    殻の登録より後に動的に読み込む
 * 4. main へ `ready` を送る
 *
 * `init` より後に届いた指示（画面との接続・終了など）の扱いと、起動の失敗の扱いは `./controller.ts` が持つ。
 */
import path from 'node:path';

import {
  captureException,
  captureMessage,
  flush as flushSentry,
  init as initSentry,
} from '@sentry/electron/utility';

import type { MessageChannel } from '../../shared/trpcTransport';
import {
  BACKEND_SHUTDOWN_TIMEOUT_MS,
  type BackendToMainMessage,
  MainToBackendSchema,
  parseControlMessage,
} from '../lib/backendProcess/protocol';
import { registerHost } from '../lib/host';
import type { HostInfo } from '../lib/host/types';
import { createHostRpcClient } from '../lib/hostRpc/client';
import type { HostRequest } from '../lib/hostRpc/protocol';
import {
  configureBackendLogFile,
  configureErrorReporting,
  logger,
} from '../lib/logger';
import { serveTrpcOnPort } from '../lib/trpcTransport/backend';
import {
  type BackendRuntime,
  createBackendController,
  type InitMessage,
} from './controller';

/** Sentry に送れずに終了するのを避けるため、終了の前に送信を待つ上限 */
const SENTRY_FLUSH_TIMEOUT_MS = 2_000;

/**
 * 終了のときに、実行中の DB の処理が終わるのを待つ上限。
 * この待ちと Sentry への送信の待ちを、main が強制終了するまでの時間の内に収め、DB を閉じる時間を残す
 */
const DB_DRAIN_TIMEOUT_MS =
  BACKEND_SHUTDOWN_TIMEOUT_MS - SENTRY_FLUSH_TIMEOUT_MS - 1_000;

const parentPort = process.parentPort;

/** main との通信路。殻の操作の要求と応答、制御メッセージが同じ port を流れる */
const mainChannel: MessageChannel<HostRequest | BackendToMainMessage, unknown> =
  {
    send: (message) => {
      parentPort.postMessage(message);
    },
    onMessage: (listener) => {
      const onMessage = (event: Electron.MessageEvent) => {
        listener(event.data);
      };
      parentPort.on('message', onMessage);
      return () => {
        parentPort.off('message', onMessage);
      };
    },
  };

const exitAfterFlush = async (code: number): Promise<never> => {
  await flushSentry(SENTRY_FLUSH_TIMEOUT_MS);
  process.exit(code);
};

/**
 * DB のファイルの場所。ユーザーデータのディレクトリに置く。
 * Sequelize の SQLite は区切りに `/` を使うパスを前提にするので、Windows の区切りを置き換える。
 */
const resolveDatabasePath = (info: HostInfo): string =>
  path
    .join(info.paths.userData, 'db.sqlite')
    .split(path.sep)
    .join(path.posix.sep);

/** `init` を受けて、処理本体の準備を進める */
const start = async (init: InitMessage): Promise<BackendRuntime> => {
  const { info } = init;
  configureBackendLogFile({
    logsDir: info.paths.logs,
    isPackaged: info.isPackaged,
  });
  if (init.errorReporting) {
    // イベントは main の SDK へ渡り、main の beforeSend が規約への同意と伏せ字を確かめてから送る
    initSentry({ debug: !info.isPackaged });
  }

  const hostRpc = createHostRpcClient(mainChannel);
  registerHost({ info, shell: hostRpc.shell, updater: hostRpc.updater });

  const { initSettingStore } = await import('../module/settingStore');
  const settingStore = initSettingStore();
  configureErrorReporting({
    source: 'electron-backend',
    isTermsAccepted: () => settingStore.getTermsAccepted(),
    captureException,
    captureMessage,
  });

  const { initRDBClient, closeRDBClient } = await import('../lib/sequelize');
  const { drainDBQueues } = await import('../lib/dbQueue');
  await initRDBClient({ db_url: resolveDatabasePath(info) });

  const [{ router }, { eventEmitter }, backgroundTimer, cleanupScheduler] =
    await Promise.all([
      import('../api'),
      import('../trpc'),
      import('../module/logSync/backgroundTimer'),
      import('../module/vrchatPhoto/thumbnailCacheCleanupScheduler'),
    ]);
  cleanupScheduler.startThumbnailCacheCleanupScheduler();

  const connections = new Map<string, () => void>();

  return {
    openConnection: (connectionId, port) => {
      const close = serveTrpcOnPort(port, {
        router,
        // ctx は electron/trpc.ts の initTRPC.context が宣言する形で渡す。procedure は ctx を読まず、
        // イベントは electron/trpc.ts の eventEmitter を直接使う
        createContext: () => ({ eventEmitter }),
      });
      connections.set(connectionId, close);
    },
    closeConnection: (connectionId) => {
      connections.get(connectionId)?.();
      connections.delete(connectionId);
    },
    setBackgroundSync: (enabled) => {
      if (enabled) {
        backgroundTimer.startBackgroundSyncTimer(settingStore);
      } else {
        backgroundTimer.stopBackgroundSyncTimer();
      }
    },
    setWindowBounds: (bounds) => {
      settingStore.setWindowBounds(bounds);
    },
    // 新しい処理が始まらないよう、タイマーと画面との接続を先に止める。実行中の DB の処理を待ってから
    // DB を閉じ、殻の操作の待ちは最後に打ち切る（DB の処理の途中で殻の操作を待つことがあるため）
    shutdown: async () => {
      backgroundTimer.stopBackgroundSyncTimer();
      cleanupScheduler.stopThumbnailCacheCleanupScheduler();
      for (const close of connections.values()) {
        close();
      }
      connections.clear();
      const drained = await drainDBQueues(DB_DRAIN_TIMEOUT_MS);
      if (!drained) {
        logger.warn(
          `DB tasks did not finish within ${String(DB_DRAIN_TIMEOUT_MS)}ms, closing the database anyway`,
        );
      }
      await closeRDBClient();
      hostRpc.dispose();
    },
  };
};

const controller = createBackendController({
  start,
  sendReady: () => {
    mainChannel.send({ kind: 'ready' });
  },
  exit: exitAfterFlush,
  log: {
    info: (message) => logger.info(message),
    warn: (message) => logger.warn(message),
    error: (params) => logger.error(params),
  },
});

parentPort.on('message', (event: Electron.MessageEvent) => {
  const message = parseControlMessage(MainToBackendSchema, event.data);
  // 殻の操作の応答とエラー監視のメッセージは、それぞれの受け手が読む
  if (message !== null) {
    controller.handle(message, event.ports);
  }
});

process.on('uncaughtException', (error) => logger.error({ message: error }));
process.on('unhandledRejection', (error) => logger.error({ message: error }));
