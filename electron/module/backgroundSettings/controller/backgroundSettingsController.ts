import z from 'zod';

import { getApp } from '../../../lib/electronModules';
import { logger } from '../../../lib/logger';
import { UserFacingError } from './../../../lib/errors';
import { procedure, router as trpcRouter } from './../../../trpc';
import type { getSettingStore } from './../../settingStore';

/**
 * バックグラウンド用ファイル生成設定を取得するヘルパー。
 * Router 内から呼び出される。
 */
const getIsBackgroundFileCreationEnabled =
  (settingStore: ReturnType<typeof getSettingStore>) =>
  async (): Promise<boolean> => {
    const flag = settingStore.getBackgroundFileCreateFlag();
    // デフォルトは true にする
    return flag ?? true;
  };

/**
 * バックグラウンド用ファイル生成設定を更新するヘルパー。
 * Router 内から呼び出される。
 */
const setIsBackgroundFileCreationEnabled =
  (settingStore: ReturnType<typeof getSettingStore>) =>
  async (isEnabled: boolean) => {
    settingStore.setBackgroundFileCreateFlag(isEnabled);
  };

/**
 * アプリの自動起動設定が有効かを取得するユーティリティ。
 * SystemSettings コンポーネントから利用される。
 */
const getIsAppAutoStartEnabled = async (): Promise<boolean> => {
  const loginItemSettings = getApp().getLoginItemSettings();
  return loginItemSettings.openAtLogin;
};

/**
 * アプリの自動起動設定を変更するユーティリティ。
 * SystemSettings からの更新操作に用いられる。
 */
/**
 * アプリの自動起動設定を変更するユーティリティ。
 * SystemSettings からの更新操作に用いられる。
 *
 * OS のログインアイテムと settingStore の両方に保存する。
 * settingStore への保存は、アップデートで exe パスが変わった際に
 * ユーザーの意図を復元するため。
 */
const setIsAppAutoStartEnabled = async (
  isEnabled: boolean,
  settingStore: ReturnType<typeof getSettingStore>,
) => {
  // macOSの場合、openAsHiddenをtrueに設定することで、バックグラウンドで起動するように
  getApp().setLoginItemSettings({
    openAtLogin: isEnabled,
    openAsHidden: true,
  });

  // ユーザーの意図を永続化（アップデート後の復元用）
  settingStore.setAutoStartEnabled(isEnabled);
  logger.info(`Auto-start intent saved to settingStore: ${isEnabled}`);

  // 設定が反映されるまで少し待つ
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 100);
  });

  // 設定が反映されたか確認
  const newSettings = getApp().getLoginItemSettings();

  if (newSettings.openAtLogin !== isEnabled) {
    throw new UserFacingError('自動起動設定の更新に失敗しました。');
  }

  return true;
};

export const backgroundSettingsRouter = (
  settingStore: ReturnType<typeof getSettingStore>,
) =>
  trpcRouter({
    getIsBackgroundFileCreationEnabled: procedure.query(async () => {
      const result = await getIsBackgroundFileCreationEnabled(settingStore)();
      return result;
    }),
    setIsBackgroundFileCreationEnabled: procedure
      .input(z.boolean())
      .mutation(async (ctx) => {
        await setIsBackgroundFileCreationEnabled(settingStore)(ctx.input);
      }),
    getIsAppAutoStartEnabled: procedure.query(async () => {
      const result = await getIsAppAutoStartEnabled();
      return result;
    }),
    setIsAppAutoStartEnabled: procedure
      .input(z.boolean())
      .mutation(async (ctx) => {
        const result = await setIsAppAutoStartEnabled(ctx.input, settingStore);
        return result;
      }),
    getWorldJoinImageGenerationEnabled: procedure.query(() => {
      return settingStore.getWorldJoinImageGenerationEnabled();
    }),
    setWorldJoinImageGenerationEnabled: procedure
      .input(z.boolean())
      .mutation((ctx) => {
        settingStore.setWorldJoinImageGenerationEnabled(ctx.input);
      }),
  });
