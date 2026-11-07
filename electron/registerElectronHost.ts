/**
 * 処理本体（electron/api.ts と electron/module/）が使う殻を、main プロセスに登録する。
 *
 * `electron/index.ts` が最初の import として読み込む。処理本体のモジュールには、読み込まれた時点で
 * 殻の値を使うもの（`electron/api.ts` が設定ストアを開くときの保存先など）があるため、
 * どの処理本体のモジュールより先に評価されるよう、副作用だけを持つ独立したモジュールにしている。
 *
 * このモジュールは処理本体（api.ts・trpc.ts）を import しない。import すると、
 * 登録より先に処理本体が評価される。
 */
import { autoUpdater } from 'electron-updater';

import { reloadMainWindow } from './electronUtil';
import { registerHost } from './lib/host';
import { createElectronHost } from './lib/host/electronHost';
import { createElectronUpdater } from './lib/host/electronUpdater';
import { initializeMainSentry } from './lib/sentryMain';

registerHost(
  createElectronHost({
    reloadWindow: reloadMainWindow,
    onTermsAccepted: initializeMainSentry,
    updater: createElectronUpdater(autoUpdater),
  }),
);
