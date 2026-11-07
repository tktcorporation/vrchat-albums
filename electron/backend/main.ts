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
 * `init` より後に届いた指示（画面との接続・終了など）は、準備が済むまで届いた順に待たせる。
 */
import path from 'node:path';

import {
  captureException,
  captureMessage,
  flush as flushSentry,
  init as initSentry,
} from '@sentry/electron/utility';
import type { MessagePortMain } from 'electron';
import { match } from 'ts-pattern';

import type { MessageChannel } from '../../shared/trpcTransport';
import {
  type BackendToMainMessage,
  type MainToBackendMessage,
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

/** Sentry に送れずに終了するのを避けるため、終了の前に送信を待つ上限 */
const SENTRY_FLUSH_TIMEOUT_MS = 2_000;

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

/** 準備が済んだ処理本体。指示はこれを受け取ってから実行する */
interface Runtime {
  readonly openConnection: (
    connectionId: string,
    port: MessagePortMain,
  ) => void;
  readonly closeConnection: (connectionId: string) => void;
  readonly startBackgroundSync: () => void;
  readonly setWindowBounds: (bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  readonly shutdown: () => Promise<void>;
}

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
const start = async (init: {
  readonly info: HostInfo;
  readonly errorReporting: boolean;
}): Promise<Runtime> => {
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
    startBackgroundSync: () => {
      backgroundTimer.startBackgroundSyncTimer(settingStore);
    },
    setWindowBounds: (bounds) => {
      settingStore.setWindowBounds(bounds);
    },
    shutdown: async () => {
      for (const close of connections.values()) {
        close();
      }
      connections.clear();
      hostRpc.dispose();
      await closeRDBClient();
    },
  };
};

/** 起動の失敗や終了の指示で、受け付けた後の指示を実行しないための印 */
let runtime: Promise<Runtime> | null = null;

const handle = (message: MainToBackendMessage, ports: MessagePortMain[]) => {
  match(message)
    .with({ kind: 'init' }, (init) => {
      if (runtime !== null) {
        logger.warn('Backend received init twice, ignoring');
        return;
      }
      runtime = start(init);
      runtime
        .then(() => {
          mainChannel.send({ kind: 'ready' });
          logger.info('Backend ready');
        })
        .catch(async (error: unknown) => {
          logger.error({ message: error });
          await exitAfterFlush(1);
        });
    })
    .otherwise((command) => {
      if (runtime === null) {
        logger.warn(`Backend received ${command.kind} before init, ignoring`);
        return;
      }
      void runtime.then((ready) =>
        match(command)
          .with({ kind: 'connect' }, ({ connectionId }) => {
            const [port] = ports;
            if (port === undefined) {
              logger.warn(`connect without a port: ${connectionId}`);
              return;
            }
            ready.openConnection(connectionId, port);
          })
          .with({ kind: 'disconnect' }, ({ connectionId }) => {
            ready.closeConnection(connectionId);
          })
          .with({ kind: 'startBackgroundSync' }, () => {
            ready.startBackgroundSync();
          })
          .with({ kind: 'setWindowBounds' }, ({ bounds }) => {
            ready.setWindowBounds(bounds);
          })
          .with({ kind: 'shutdown' }, () => {
            void ready
              .shutdown()
              .catch((error: unknown) => {
                logger.error({ message: error });
              })
              .then(() => exitAfterFlush(0));
          })
          .exhaustive(),
      );
    });
};

parentPort.on('message', (event: Electron.MessageEvent) => {
  const message = parseControlMessage(MainToBackendSchema, event.data);
  // 殻の操作の応答とエラー監視のメッセージは、それぞれの受け手が読む
  if (message !== null) {
    handle(message, event.ports);
  }
});

process.on('uncaughtException', (error) => logger.error({ message: error }));
process.on('unhandledRejection', (error) => logger.error({ message: error }));
