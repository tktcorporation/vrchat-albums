/**
 * main プロセスで、処理本体（utilityProcess）を起動し、見張り、終了させる。
 *
 * 処理本体は tRPC の router・サービス・DB・worker を持ち、main はウィンドウ・トレイ・自動更新・OS の操作を持つ。
 * main と処理本体の取り決めは `./protocol.ts`（起動・終了・指示）と `electron/lib/hostRpc/protocol.ts`（殻の操作）にある。
 *
 * 処理本体が予期せず終了したら、`./restartPolicy.ts` の判断で起動し直し、起動時の情報を送り直してから
 * `onRestarted` を呼ぶ（呼び出し側が全ウィンドウを再読み込みし、画面との接続を張り直す）。
 * 起動し直しを諦めたときは `onGiveUp` を呼ぶ。
 */
import * as path from 'node:path';

import type { MessagePortMain, UtilityProcess } from 'electron';
import { match } from 'ts-pattern';

import type { MessageChannel } from '../../../shared/trpcTransport';
import { getUtilityProcess } from '../electronModules';
import type { HostInfo, HostShell, HostUpdater } from '../host/types';
import type { HostResponse } from '../hostRpc/protocol';
import { serveHostRpc } from '../hostRpc/server';
import { logger } from '../logger';
import {
  BackendToMainSchema,
  type MainToBackendMessage,
  parseControlMessage,
} from './protocol';
import { createRestartPolicy, type RestartDecision } from './restartPolicy';

/** 終了を頼んでから、処理本体が自分で終わるのを待つ上限。超えたら強制終了する */
const SHUTDOWN_TIMEOUT_MS = 5_000;

/** `app.getAppMetrics()` などで処理本体を見分けるための名前 */
export const BACKEND_SERVICE_NAME = 'vrchat-albums-backend';

export interface BackendSupervisorOptions {
  /** 起動のたびに送る、殻についての情報 */
  readonly hostInfo: HostInfo;
  /** main がエラー監視を初期化したか */
  readonly errorReporting: boolean;
  /** 処理本体からの殻の操作の要求を実行する実装 */
  readonly shell: HostShell;
  readonly updater: HostUpdater;
  /** 予期しない終了の後に起動し直し、起動時の情報を送った後に呼ぶ */
  readonly onRestarted: () => void;
  /** 起動し直しを諦めたときに呼ぶ */
  readonly onGiveUp: () => void;
}

export interface BackendSupervisor {
  /** 処理本体を起動する。`app` の準備ができた後に 1 度だけ呼ぶ */
  start(): void;
  /** 制御メッセージを送る。処理本体が動いていなければ捨てる */
  send(message: Exclude<MainToBackendMessage, { kind: 'connect' }>): void;
  /** 画面の文書 1 つ分の接続の port を渡す。処理本体が動いていなければ port を閉じる */
  connect(connectionId: string, port: MessagePortMain): void;
  disconnect(connectionId: string): void;
  /** 処理本体に終了を頼み、終わるのを待つ。待ちすぎたら強制終了する */
  stop(): Promise<void>;
}

/**
 * 処理本体の標準出力・標準エラーを、行ごとに main のログへ流す。
 * 処理本体がログの保存先を受け取る前の出力や、Node 自身が出すエラーを残すため。
 */
const forwardLines = (
  stream: NodeJS.ReadableStream | null,
  write: (line: string) => void,
): void => {
  if (stream === null) {
    return;
  }
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string | Buffer) => {
    buffer += String(chunk);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length > 0) {
        write(line);
      }
    }
  });
};

/** utilityProcess を、殻の操作の要求と応答を運ぶ通信路として扱う */
const createChildChannel = (
  child: UtilityProcess,
): MessageChannel<HostResponse, unknown> => ({
  send: (message) => {
    child.postMessage(message);
  },
  onMessage: (listener) => {
    child.on('message', listener);
    // エラー監視の SDK は child.on を包むので、removeListener では外せない。
    // 終了した処理本体の child は捨てるだけなので、受信をやめる操作は要らない
    return () => {};
  },
});

/**
 * 処理本体の入口のファイル。main のバンドルと同じディレクトリ（`main/`）にある。
 *
 * パッケージ時も app.asar の中のパスのまま起動する。処理本体が読み込む JavaScript の依存
 * （electron-store・Sequelize など）は app.asar の中の node_modules にしか無く、
 * app.asar.unpacked から起動すると見つからない。utilityProcess の Node は app.asar を読める。
 */
const resolveBackendScriptPath = (): string =>
  path.join(__dirname, 'backend.cjs');

export const createBackendSupervisor = (
  options: BackendSupervisorOptions,
): BackendSupervisor => {
  const decideRestart = createRestartPolicy();
  let child: UtilityProcess | null = null;
  let stopping: Promise<void> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  const spawn = (): void => {
    const forked = getUtilityProcess().fork(resolveBackendScriptPath(), [], {
      serviceName: BACKEND_SERVICE_NAME,
      stdio: 'pipe',
      env: process.env,
    });
    child = forked;

    forwardLines(forked.stdout, (line) => logger.info(`[backend] ${line}`));
    forwardLines(forked.stderr, (line) => logger.warn(`[backend] ${line}`));

    forked.on('message', (raw: unknown) => {
      const message = parseControlMessage(BackendToMainSchema, raw);
      if (message === null) {
        return;
      }
      match(message)
        .with({ kind: 'ready' }, () => {
          logger.info(`Backend ready (pid: ${String(forked.pid)})`);
        })
        .exhaustive();
    });
    serveHostRpc(createChildChannel(forked), {
      shell: options.shell,
      updater: options.updater,
    });

    forked.once('exit', (code) => {
      if (child === forked) {
        child = null;
      }
      if (stopping !== null) {
        return;
      }
      onUnexpectedExit(code);
    });

    forked.postMessage({
      kind: 'init',
      info: options.hostInfo,
      errorReporting: options.errorReporting,
    } satisfies MainToBackendMessage);
  };

  const onUnexpectedExit = (code: number): void => {
    const decision: RestartDecision = decideRestart(Date.now());
    logger.error({
      message: new Error(
        `Backend process exited unexpectedly (code: ${String(code)})`,
      ),
      details: { decision },
    });
    match(decision)
      .with({ action: 'restart' }, ({ delayMs }) => {
        restartTimer = setTimeout(() => {
          restartTimer = null;
          if (stopping !== null) {
            return;
          }
          spawn();
          options.onRestarted();
        }, delayMs);
      })
      .with({ action: 'giveUp' }, () => {
        options.onGiveUp();
      })
      .exhaustive();
  };

  return {
    start: () => {
      if (child === null && stopping === null) {
        spawn();
      }
    },
    send: (message) => {
      if (child === null) {
        logger.debug(
          `Backend is not running, dropping message: ${message.kind}`,
        );
        return;
      }
      child.postMessage(message);
    },
    connect: (connectionId, port) => {
      if (child === null) {
        // 画面は処理本体の起動し直しの後に再読み込みされ、そのときに接続し直す
        port.close();
        return;
      }
      child.postMessage(
        { kind: 'connect', connectionId } satisfies MainToBackendMessage,
        [port],
      );
    },
    disconnect: (connectionId) => {
      child?.postMessage({
        kind: 'disconnect',
        connectionId,
      } satisfies MainToBackendMessage);
    },
    stop: () => {
      if (stopping !== null) {
        return stopping;
      }
      if (restartTimer !== null) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      const running = child;
      if (running === null) {
        stopping = Promise.resolve();
        return stopping;
      }
      stopping = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          logger.warn(
            'Backend did not exit in time after shutdown, killing it',
          );
          running.kill();
        }, SHUTDOWN_TIMEOUT_MS);
        running.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
        running.postMessage({
          kind: 'shutdown',
        } satisfies MainToBackendMessage);
      });
      return stopping;
    },
  };
};
