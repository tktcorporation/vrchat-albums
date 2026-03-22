import { match } from 'ts-pattern';

import type { getSettingStore } from './settingStore';

/**
 * 設定ストアからバックグラウンド処理の有効可否を取得する
 * Electron 起動時や終了時判定で利用される
 */
const getIsEnabledBackgroundProcess =
  (settingStore: ReturnType<typeof getSettingStore>) => () => {
    const backgroundFileCreateFlag = settingStore.getBackgroundFileCreateFlag();

    return match(backgroundFileCreateFlag)
      .with(null, () => false)
      .otherwise((flag) => flag);
  };

/**
 * バックグラウンド関連のユースケースオブジェクトを生成する
 * index.ts から参照される
 */
const getBackgroundUsecase = (
  settingStore: ReturnType<typeof getSettingStore>,
) => {
  return {
    getIsEnabledBackgroundProcess: getIsEnabledBackgroundProcess(settingStore),
  };
};

export { getBackgroundUsecase };
