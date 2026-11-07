/**
 * 処理本体（utilityProcess）が main から受け取るメッセージを、起動の段階に合わせて捌く。
 *
 * 入口（`./main.ts`）が Electron の parentPort・エラー監視・プロセスの終了をつなぎ、この関数は
 * 段階の移り変わりだけを持つ。段階を 1 か所で持つのは、起動の失敗や終了の後に届いた指示を
 * 確実に捨て、失敗を 1 度だけ報告するため。
 *
 * 段階:
 * - `awaitingInit`: `init` を待つ。ほかの指示は捨てる
 * - `starting`: 設定と DB を開いている。届いた指示は届いた順に溜め、準備が済んだら流す
 * - `ready`: 指示をすぐ実行する
 * - `failed`: 起動に失敗した。溜めた指示も含めて捨て、プロセスを終える
 * - `shuttingDown`: 終了を始めた。以降の指示は捨てる
 */
import type { MessagePortMain } from 'electron';
import { match } from 'ts-pattern';

import type { MainToBackendMessage } from '../lib/backendProcess/protocol';

export type InitMessage = Extract<MainToBackendMessage, { kind: 'init' }>;
type Command = Exclude<MainToBackendMessage, { kind: 'init' }>;

/** 準備が済んだ処理本体。指示はこれを受け取ってから実行する */
export interface BackendRuntime {
  readonly openConnection: (
    connectionId: string,
    port: MessagePortMain,
  ) => void;
  readonly closeConnection: (connectionId: string) => void;
  readonly setBackgroundSync: (enabled: boolean) => void;
  readonly setWindowBounds: (bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  /** 動いている処理を止め、DB を閉じる。プロセスは終えない */
  readonly shutdown: () => Promise<void>;
}

export interface BackendControllerDeps {
  /** `init` を受けて処理本体の準備をする */
  readonly start: (init: InitMessage) => Promise<BackendRuntime>;
  /** main へ準備の完了を知らせる */
  readonly sendReady: () => void;
  /** プロセスを終える。エラー監視への送信を待ってから終えるため非同期 */
  readonly exit: (code: number) => Promise<unknown>;
  readonly log: {
    readonly info: (message: string) => void;
    readonly warn: (message: string) => void;
    readonly error: (params: { message: unknown }) => void;
  };
}

interface PendingCommand {
  readonly command: Command;
  readonly ports: readonly MessagePortMain[];
}

type Phase =
  | { readonly phase: 'awaitingInit' }
  | { readonly phase: 'starting'; readonly queue: PendingCommand[] }
  | { readonly phase: 'ready'; readonly runtime: BackendRuntime }
  | { readonly phase: 'failed' }
  | { readonly phase: 'shuttingDown' };

export interface BackendController {
  /** main からの制御メッセージを 1 つ受け取る。`ports` はメッセージに添えられた MessagePort */
  readonly handle: (
    message: MainToBackendMessage,
    ports: readonly MessagePortMain[],
  ) => void;
}

export const createBackendController = (
  deps: BackendControllerDeps,
): BackendController => {
  let state: Phase = { phase: 'awaitingInit' };

  /** 実行しない指示に添えられた port を閉じる。閉じないと画面の側の呼び出しが応答を待ち続ける */
  const discard = ({ command, ports }: PendingCommand, reason: string) => {
    for (const port of ports) {
      port.close();
    }
    deps.log.warn(`Backend dropped ${command.kind}: ${reason}`);
  };

  const run = (runtime: BackendRuntime, pending: PendingCommand): void => {
    match(pending.command)
      .with({ kind: 'connect' }, ({ connectionId }) => {
        const [port] = pending.ports;
        if (port === undefined) {
          deps.log.warn(`connect without a port: ${connectionId}`);
          return;
        }
        runtime.openConnection(connectionId, port);
      })
      .with({ kind: 'disconnect' }, ({ connectionId }) => {
        runtime.closeConnection(connectionId);
      })
      .with({ kind: 'setBackgroundSync' }, ({ enabled }) => {
        runtime.setBackgroundSync(enabled);
      })
      .with({ kind: 'setWindowBounds' }, ({ bounds }) => {
        runtime.setWindowBounds(bounds);
      })
      .with({ kind: 'shutdown' }, () => {
        state = { phase: 'shuttingDown' };
        void runtime
          .shutdown()
          .catch((error: unknown) => {
            deps.log.error({ message: error });
          })
          .then(() => deps.exit(0));
      })
      .exhaustive();
  };

  const onReady = (init: InitMessage, runtime: BackendRuntime): void => {
    if (state.phase !== 'starting') {
      return;
    }
    const { queue } = state;
    state = { phase: 'ready', runtime };
    runtime.setBackgroundSync(init.backgroundSync);
    deps.sendReady();
    deps.log.info('Backend ready');
    for (const pending of queue) {
      // 溜めた指示の中の shutdown より後の指示は実行しない
      if (state.phase !== 'ready') {
        discard(pending, 'backend is shutting down');
        continue;
      }
      run(runtime, pending);
    }
  };

  const onStartFailed = (error: unknown): void => {
    if (state.phase !== 'starting') {
      return;
    }
    const { queue } = state;
    state = { phase: 'failed' };
    deps.log.error({ message: error });
    for (const pending of queue) {
      discard(pending, 'backend failed to start');
    }
    void deps.exit(1);
  };

  const startWith = (init: InitMessage): void => {
    state = { phase: 'starting', queue: [] };
    // start が同期的に投げた例外も、非同期の失敗と同じ経路で 1 度だけ扱う
    void Promise.resolve()
      .then(() => deps.start(init))
      .then(
        (runtime) => onReady(init, runtime),
        (error: unknown) => onStartFailed(error),
      );
  };

  return {
    handle: (message, ports) => {
      if (message.kind === 'init') {
        if (state.phase !== 'awaitingInit') {
          deps.log.warn('Backend received init twice, ignoring');
          return;
        }
        startWith(message);
        return;
      }
      const pending: PendingCommand = { command: message, ports };
      match(state)
        .with({ phase: 'awaitingInit' }, () => {
          discard(pending, 'received before init');
        })
        .with({ phase: 'starting' }, ({ queue }) => {
          queue.push(pending);
        })
        .with({ phase: 'ready' }, ({ runtime }) => {
          run(runtime, pending);
        })
        .with({ phase: 'failed' }, () => {
          discard(pending, 'backend failed to start');
        })
        .with({ phase: 'shuttingDown' }, () => {
          discard(pending, 'backend is shutting down');
        })
        .exhaustive();
    },
  };
};
