/**
 * main プロセスで、アプリ全体の状態のうち「常駐中か」と「終了の手順」を 1 か所で持つ。
 *
 * 常駐中か（ウィンドウをすべて閉じてトレイに残っているか）は、処理本体（utilityProcess）の
 * 定期的なログの同期を動かすかを決める。処理本体は落ちて起動し直すことがあるので、
 * 状態はここに持ち、処理本体には変わったときと起動のたびに伝える（`./backendProcess/supervisor.ts` の
 * `isBackgroundSyncEnabled`）。止まっている間に常駐へ入っても、次の起動で伝わる。
 *
 * 終了の手順は、通常の終了（`before-quit`）と更新のインストール（`quitAndInstall`）で同じものを使う。
 * 1. ウィンドウの位置と大きさの保存を処理本体へ頼む（処理本体が設定ファイルを書く）
 * 2. ウィンドウをすべて隠す。画面との接続はこの後で閉じるので、操作できるように見せない
 * 3. 処理本体に終了を頼み、DB を閉じて終わるのを待つ
 * 手順は 1 度だけ走り、終わった後の `before-quit` は待たずに通す。
 * 手順が始まった後はウィンドウを出さない（`whenRunning`）。出しても画面との接続は閉じていて操作できない。
 *
 * Electron の `app` とウィンドウは引数で受け取る。テストが偽物を渡して手順を確かめるため。
 */
import { match } from 'ts-pattern';

import type { BackendSupervisor } from './backendProcess/supervisor';

/** このモジュールが使う Electron の `app` の部分 */
export interface LifecycleApp {
  on(event: 'window-all-closed', listener: () => void): unknown;
  on(event: 'browser-window-created', listener: () => void): unknown;
  on(event: 'will-quit', listener: () => void): unknown;
  on(
    event: 'before-quit',
    listener: (event: { preventDefault(): void }) => void,
  ): unknown;
  quit(): void;
}

/** 終了の手順で隠すウィンドウ */
export interface LifecycleWindow {
  isDestroyed(): boolean;
  hide(): void;
}

export interface AppLifecycleDeps {
  readonly app: LifecycleApp;
  readonly backend: Pick<BackendSupervisor, 'send' | 'stop'>;
  readonly getWindows: () => readonly LifecycleWindow[];
  /** メインウィンドウの位置と大きさの保存を処理本体へ頼む */
  readonly saveWindowBounds: () => void;
  /** 設定の「ウィンドウを閉じても常駐する」。ウィンドウをすべて閉じたときに読む */
  readonly isBackgroundEnabled: () => boolean;
  readonly platform: NodeJS.Platform;
}

export interface AppLifecycle {
  /** アプリが常駐中か。処理本体の起動のたびに読まれる */
  readonly isInBackground: () => boolean;
  /**
   * 終了の手順を走らせ、処理本体が終わるまで待つ。何度呼んでも手順は 1 度だけ走る。
   * アプリは終えない（終えるのは呼び出し側。`before-quit` か electron-updater）
   */
  readonly shutdown: () => Promise<void>;
  /** 終了の手順が始まっているか */
  readonly isShuttingDown: () => boolean;
  /**
   * 終了の手順が始まっていなければ `fn` を実行する。トレイ・二重起動・Dock からウィンドウを出す入口が使う
   */
  readonly whenRunning: (fn: () => void) => void;
  /**
   * アプリを終える。終了が確定した（`will-quit` が届いた）後なら何もしない。
   * 更新のインストーラを起動できず、アプリが終わらないまま残るのを防ぐために使う
   */
  readonly forceQuit: () => void;
}

type ShutdownPhase =
  | { readonly phase: 'running' }
  | { readonly phase: 'stopping'; readonly done: Promise<void> }
  | { readonly phase: 'stopped' };

/**
 * アプリの状態を持ち、`app` のイベントを購読する。main プロセスで 1 度だけ作る。
 */
export const createAppLifecycle = (deps: AppLifecycleDeps): AppLifecycle => {
  let inBackground = false;
  let shutdownPhase: ShutdownPhase = { phase: 'running' };
  let willQuit = false;

  const setBackground = (enabled: boolean): void => {
    if (inBackground === enabled) {
      return;
    }
    inBackground = enabled;
    deps.backend.send({ kind: 'setBackgroundSync', enabled });
  };

  const shutdown = (): Promise<void> =>
    match(shutdownPhase)
      .with({ phase: 'stopped' }, () => Promise.resolve())
      .with({ phase: 'stopping' }, ({ done }) => done)
      .with({ phase: 'running' }, () => {
        deps.saveWindowBounds();
        for (const window of deps.getWindows()) {
          if (!window.isDestroyed()) {
            window.hide();
          }
        }
        const done = deps.backend.stop().then(() => {
          shutdownPhase = { phase: 'stopped' };
        });
        shutdownPhase = { phase: 'stopping', done };
        return done;
      })
      .exhaustive();

  deps.app.on('window-all-closed', () => {
    // macOS はウィンドウを閉じてもアプリを動かし続ける慣習なので、常駐とは扱わない
    if (deps.platform === 'darwin') {
      return;
    }
    if (deps.isBackgroundEnabled()) {
      setBackground(true);
      return;
    }
    deps.app.quit();
  });

  // 常駐中にウィンドウを開くのは、トレイ・二重起動・Dock からウィンドウを作り直すときだけ
  deps.app.on('browser-window-created', () => {
    setBackground(false);
  });

  // 処理本体に DB を閉じさせてから終える。終了の途中で DB への書き込みが切れないようにするため
  deps.app.on('before-quit', (event) => {
    if (shutdownPhase.phase === 'stopped') {
      return;
    }
    event.preventDefault();
    void shutdown().then(() => {
      deps.app.quit();
    });
  });

  deps.app.on('will-quit', () => {
    willQuit = true;
  });

  return {
    isInBackground: () => inBackground,
    shutdown,
    isShuttingDown: () => shutdownPhase.phase !== 'running',
    whenRunning: (fn) => {
      if (shutdownPhase.phase === 'running') {
        fn();
      }
    },
    forceQuit: () => {
      if (!willQuit) {
        deps.app.quit();
      }
    },
  };
};
