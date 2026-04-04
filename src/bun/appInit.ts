/**
 * アプリケーション初期化処理。
 *
 * 背景: electron/index.ts の initializeApp() に相当する。
 * データベース初期化、設定ストアの準備を行う。
 *
 * 呼び出し元: src/bun/index.ts
 */
import path from 'node:path';

import { Utils } from 'electrobun/bun';

import * as sequelizeClient from '../../electron/lib/sequelize';
import { initSettingStore } from '../../electron/module/settingStore';

/**
 * Electrobun 環境での userData パスを取得する。
 * Electron の app.getPath('userData') に相当。
 */
export const getAppUserDataPath = (): string => {
  return Utils.paths.userData;
};

/**
 * データベースとサービスを初期化する。
 */
export const initializeApp = async (): Promise<void> => {
  // 設定ストアの初期化
  initSettingStore();

  // データベース初期化
  const dbPath = path
    .join(getAppUserDataPath(), 'db.sqlite')
    .split(path.sep)
    .join(path.posix.sep);
  await sequelizeClient.initRDBClient({ db_url: dbPath });

  console.log(`[AppInit] Database initialized at: ${dbPath}`);
};
