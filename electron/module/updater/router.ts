import { procedure, router } from '../../trpc';
import { UpdaterService } from './service';

const updaterService = new UpdaterService();

export const updaterRouter = router({
  checkForUpdates: procedure.mutation(async () => {
    // アップデートチェック失敗は非致命的なのでエラーを握りつぶす
    // 結果は呼び出し側で使用しない（バックグラウンド処理）
    const result = await updaterService.checkForUpdates();
    // エラーの場合もログはサービス側で記録済み、ここでは何もしない
    return result.unwrapOr(undefined);
  }),

  quitAndInstall: procedure.mutation(async () => {
    await updaterService.quitAndInstall();
  }),

  getUpdateStatus: procedure.query(() => {
    return {
      updateDownloaded: updaterService.getUpdateDownloaded(),
    };
  }),
});
