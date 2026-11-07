import { Effect } from 'effect';

import { procedure, router } from '../../trpc';
import * as updaterService from './service';

export const updaterRouter = router({
  checkForUpdates: procedure.mutation(async () => {
    // アップデートチェック失敗は非致命的なのでエラーを握りつぶす
    // 結果は呼び出し側で使用しない（バックグラウンド処理）
    const exit = await Effect.runPromiseExit(updaterService.checkForUpdates());
    if (exit._tag === 'Success') {
      return exit.value;
    }
    // エラーの場合もログはサービス側で記録済み、ここでは何もしない
  }),

  quitAndInstall: procedure.mutation(async () => {
    await updaterService.quitAndInstall();
  }),

  getUpdateStatus: procedure.query(async () => {
    const status = await updaterService.getUpdateStatus();
    return {
      updateDownloaded: status.updateDownloaded,
      availableVersion: status.availableVersion,
      canAutoInstall: status.canAutoInstall,
    };
  }),
});
