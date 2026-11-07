import type { AppUpdater, UpdateCheckResult } from 'electron-updater';
import { BehaviorSubject } from 'rxjs';

import { logger } from '../logger';
import type { HostUpdateCheckResult, HostUpdater } from './types';

/**
 * このプラットフォームでアップデートを自動でダウンロード・インストールできるか。
 *
 * macOS ビルドは署名なしの dmg だけを配布している。electron-updater の MacUpdater は
 * zip を、Squirrel.Mac はコード署名を必要とするため、macOS では自動インストールが
 * 成立しない。macOS ではダウンロードページへの誘導に切り替える。
 */
export const canAutoInstallUpdates = (
  platform: NodeJS.Platform = process.platform,
): boolean => platform !== 'darwin';

/** 殻の更新が使う electron-updater の部分。テストが偽物を渡せるよう、使う操作だけに絞る */
export type AutoUpdaterSource = Pick<
  AppUpdater,
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'on'
  | 'checkForUpdates'
  | 'quitAndInstall'
>;

/**
 * インストールを electron-updater に渡してから、アプリが終わるのを待つ上限。
 *
 * electron-updater はインストーラを起動できたときだけ、すぐ（次のイベントループの周回で）アプリを終える。
 * 起動できなかったときは何もしないので、処理本体を止めてウィンドウを隠したアプリが残る。
 * 正常なら終了は 1 秒もかからず始まる（処理本体はこの時点で止まっていて、終了の手順は待たない）ので、
 * 遅いディスクでのインストーラの起動を見込んでも十分に長く、利用者が「消えたのに動いている」状態に
 * 気づく前に収まる長さにする。
 */
export const FORCE_QUIT_AFTER_INSTALL_MS = 10_000;

/** 更新のインストールのときに、殻がアプリの終了をどう扱うか */
export interface UpdaterQuitControl {
  /** 処理本体を終わらせ、その後の終了の手順で待ち直さないようにする */
  readonly prepareQuit: () => Promise<void>;
  /** アプリを終える。既に終わり始めていれば何もしない */
  readonly forceQuit: () => void;
  /** 待ってから関数を呼ぶ。テストが時間を進めずに確かめるための差し替え口。既定は setTimeout */
  readonly schedule?: (callback: () => void, delayMs: number) => void;
}

/**
 * electron-updater の確認結果を、処理本体へ渡す素のデータへ写す。
 * ダウンロードの Promise や中断用のトークンはプロセスの間で受け渡せず、処理本体も使わないので落とす。
 */
const toHostUpdateCheckResult = (
  result: UpdateCheckResult,
): HostUpdateCheckResult => ({
  isUpdateAvailable: result.isUpdateAvailable,
  updateInfo: {
    version: result.updateInfo.version,
    releaseDate: result.updateInfo.releaseDate,
    releaseName: result.updateInfo.releaseName ?? null,
    releaseNotes: result.updateInfo.releaseNotes ?? null,
  },
});

/**
 * electron-updater で自動更新を動かす殻の実装。
 *
 * 更新の状態（見つかった版・ダウンロードの完了）は electron-updater のイベントでしか届かないため、
 * 作った時点でイベントを購読して殻の側に保持し、処理本体からの問い合わせに答える。
 * main プロセスで 1 度だけ作る。作るたびにイベントの購読が増える。
 *
 * `quitAndInstall` は、先に `prepareQuit` で処理本体を終わらせてから electron-updater に渡す。
 * electron-updater はインストーラを起動してすぐにアプリを終えるので、先に渡すと処理本体が
 * DB を閉じる前にインストーラがファイルを置き換え始めうる。
 * 利用者がアプリを終えたときの自動インストール（`autoInstallOnAppQuit`）は `quit` のときに走り、
 * そのときには通常の終了の手順で処理本体は終わっている。
 *
 * @param autoUpdater electron-updater の `autoUpdater`。テストは偽物を渡す
 * インストーラを起動できなかったとき（`error` が届く、または `FORCE_QUIT_AFTER_INSTALL_MS` の間に
 * アプリが終わらない）は `forceQuit` でアプリを終える。処理本体は止まり、ウィンドウは隠れているので、
 * 残しても利用者は何もできない。次の起動で更新は改めて見つかる。
 *
 * @param quitControl インストールの前後のアプリの終了の扱い
 * @param canAutoInstall 自動ダウンロードと終了時の自動インストールを有効にするか
 */
export const createElectronUpdater = (
  autoUpdater: AutoUpdaterSource,
  quitControl: UpdaterQuitControl,
  canAutoInstall = canAutoInstallUpdates(),
): HostUpdater => {
  const schedule =
    quitControl.schedule ??
    ((callback: () => void, delayMs: number) => {
      setTimeout(callback, delayMs);
    });
  /** インストールを electron-updater に渡した後か。その後の `error` はインストールの失敗として扱う */
  let installRequested = false;
  const updateDownloaded = new BehaviorSubject<boolean>(false);
  const availableVersion = new BehaviorSubject<string | null>(null);

  autoUpdater.autoDownload = canAutoInstall;
  autoUpdater.autoInstallOnAppQuit = canAutoInstall;

  autoUpdater.on('update-available', (info) => {
    availableVersion.next(info.version);
  });

  autoUpdater.on('update-downloaded', () => {
    updateDownloaded.next(true);
  });

  // ダウンロードやインストールの失敗はイベントでしか届かないため、ここでログに残す。
  // 確認の失敗もこのイベントに届くので、処理本体が残す確認の失敗ログと重複して残る
  autoUpdater.on('error', (error) => {
    logger.warn(`アップデート処理中にエラーが発生しました: ${error.message}`);
    if (installRequested) {
      quitControl.forceQuit();
    }
  });

  return {
    checkForUpdates: async () => {
      const result = await autoUpdater.checkForUpdates();
      return result === null ? null : toHostUpdateCheckResult(result);
    },
    quitAndInstall: async () => {
      await quitControl.prepareQuit();
      installRequested = true;
      schedule(() => {
        logger.warn(
          'アップデートのインストールを始めた後もアプリが終わらないため、終了します',
        );
        quitControl.forceQuit();
      }, FORCE_QUIT_AFTER_INSTALL_MS);
      autoUpdater.quitAndInstall();
    },
    getStatus: async () => ({
      updateDownloaded: updateDownloaded.value,
      availableVersion: availableVersion.value,
      canAutoInstall,
    }),
  };
};
