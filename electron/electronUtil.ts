/**
 * ウィンドウ・トレイ管理ユーティリティ（Electrobun 互換版）。
 *
 * 背景: Electron 版では BrowserWindow, Tray, Menu, screen 等を使用していた。
 * Electrobun 移行後はこれらの機能が src/bun/ に移動したため、
 * このファイルは tRPC ルーターや他モジュールからの参照のために
 * 最小限のスタブを提供する。
 *
 * Electrobun の代替:
 *   - ウィンドウ管理: src/bun/index.ts
 *   - トレイ: src/bun/tray.ts
 *   - メニュー: src/bun/menu.ts
 */
import { Effect } from 'effect';
import { match } from 'ts-pattern';

import { showNotification } from './lib/electrobunCompat';
import { logger } from './lib/logger';
import { syncLogsInBackground } from './module/logSync/service';
import type { getSettingStore } from './module/settingStore';

/**
 * 6時間ごとにバックグラウンドログ同期を実行するタイマーを設定する。
 *
 * 背景: VRChat のログファイルを定期的にスキャンし、新しい写真・ワールド参加・
 * プレイヤー参加を検出してDBに記録する。結果は OS 通知で表示される。
 *
 * 呼び出し元: electron/index.ts (アプリ起動時に一度だけ呼ばれる)
 * 同期処理: syncLogsInBackground() (INCREMENTAL モード)
 */
export const setTimeEventEmitter = (
  passedSettingStore: ReturnType<typeof getSettingStore>,
): void => {
  const intervalEventTarget = new EventTarget();
  // 6時間ごとに実行
  setInterval(
    () => {
      intervalEventTarget.dispatchEvent(
        new CustomEvent('time', { detail: new Date() }),
      );
    },
    1000 * 60 * 60 * 6,
  );

  intervalEventTarget.addEventListener('time', (event) => {
    const now = (event as CustomEvent<Date>).detail;
    void (async () => {
      if (!passedSettingStore.getBackgroundFileCreateFlag()) {
        logger.debug('バックグラウンド処理が無効になっています');
        return;
      }

      const either = await Effect.runPromise(
        Effect.either(syncLogsInBackground()),
      );

      if (either._tag === 'Left') {
        const error = either.left;
        const errorMessage = match(error)
          .with(
            { code: 'LOG_FILE_NOT_FOUND' },
            () => 'VRChatのログファイルが見つかりませんでした',
          )
          .with(
            { code: 'LOG_FILE_DIR_NOT_FOUND' },
            () => 'VRChatのログディレクトリが見つかりませんでした',
          )
          .with(
            { code: 'LOG_FILES_NOT_FOUND' },
            () => 'VRChatのログファイルが存在しません',
          )
          .with({ code: 'UNKNOWN' }, () => '不明なエラーが発生しました')
          .otherwise(() => '予期せぬエラーが発生しました');

        logger.error({ message: error });

        showNotification({
          title: `joinの記録に失敗しました: ${now.toString()}`,
          body: errorMessage,
        });

        return;
      }

      const {
        createdVRChatPhotoPathModelList,
        createdWorldJoinLogModelList,
        createdPlayerJoinLogModelList,
      } = either.right;
      if (
        createdVRChatPhotoPathModelList.length === 0 &&
        createdWorldJoinLogModelList.length === 0 &&
        createdPlayerJoinLogModelList.length === 0
      ) {
        return;
      }

      const photoCount = createdVRChatPhotoPathModelList.length;
      const worldJoinCount = createdWorldJoinLogModelList.length;
      const playerJoinCount = createdPlayerJoinLogModelList.length;

      showNotification({
        title: `joinの記録に成功しました: ${now.toString()}`,
        body: `${photoCount}枚の新しい写真を記録しました\n${worldJoinCount}件のワールド参加を記録しました\n${playerJoinCount}件のプレイヤー参加を記録しました`,
      });
    })();
  });
};

/**
 * メインウィンドウリロードスタブ。
 */
export const reloadMainWindow = (): void => {
  logger.debug('reloadMainWindow called (Electrobun stub)');
};
