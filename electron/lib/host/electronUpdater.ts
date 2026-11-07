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
 * @param autoUpdater electron-updater の `autoUpdater`。テストは偽物を渡す
 * @param canAutoInstall 自動ダウンロードと終了時の自動インストールを有効にするか
 */
export const createElectronUpdater = (
  autoUpdater: AutoUpdaterSource,
  canAutoInstall = canAutoInstallUpdates(),
): HostUpdater => {
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
  });

  return {
    checkForUpdates: async () => {
      const result = await autoUpdater.checkForUpdates();
      return result === null ? null : toHostUpdateCheckResult(result);
    },
    quitAndInstall: async () => {
      autoUpdater.quitAndInstall();
    },
    getStatus: async () => ({
      updateDownloaded: updateDownloaded.value,
      availableVersion: availableVersion.value,
      canAutoInstall,
    }),
  };
};
