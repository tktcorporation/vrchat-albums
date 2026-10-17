import { Effect } from 'effect';
import { match } from 'ts-pattern';

import { getNotification } from '../../lib/electronModules';
import { logger } from '../../lib/logger';
import type { SettingStore } from '../settingStore';
import { hasAcceptedCurrentTerms } from '../terms/consent';
import { syncLogsInBackground } from './service';

/** バックグラウンドでログを同期する間隔（6 時間） */
const BACKGROUND_SYNC_INTERVAL_MS = 1000 * 60 * 60 * 6;

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * ウィンドウを閉じて常駐している間の、定期的なログ同期を始める。
 * ウィンドウを閉じるたびに呼ばれるが、タイマーはアプリ全体で 1 つだけにする
 * （呼ぶたびに増やすと、同期と通知が閉じた回数だけ重なる）。
 */
export const startBackgroundSyncTimer = (store: SettingStore): void => {
  if (timer !== null) {
    return;
  }
  timer = setInterval(() => {
    void runBackgroundSync(store, new Date());
  }, BACKGROUND_SYNC_INTERVAL_MS);
};

/** テスト用：タイマーを止めて、もう一度始められる状態に戻す */
export const resetBackgroundSyncTimerForTest = (): void => {
  if (timer !== null) {
    clearInterval(timer);
  }
  timer = null;
};

/**
 * 1 回分のバックグラウンド同期。設定で無効なとき、または現在の版の利用規約に同意していないときは何もしない
 * （規約の更新後、同意し直す前にウィンドウを閉じても、ログや写真を読まない）。
 */
const runBackgroundSync = async (store: SettingStore, now: Date) => {
  if (!store.getBackgroundFileCreateFlag()) {
    logger.debug('バックグラウンド処理が無効になっています');
    return;
  }
  if (!hasAcceptedCurrentTerms(store)) {
    logger.debug(
      '現在の版の利用規約に未同意のため、バックグラウンド同期を行いません',
    );
    return;
  }

  const either = await Effect.runPromise(Effect.either(syncLogsInBackground()));

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

    const Notification = getNotification();
    new Notification({
      title: `joinの記録に失敗しました: ${now.toString()}`,
      body: errorMessage,
    }).show();

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

  const Notification = getNotification();
  new Notification({
    title: `joinの記録に成功しました: ${now.toString()}`,
    body: `${createdVRChatPhotoPathModelList.length}枚の新しい写真を記録しました\n${createdWorldJoinLogModelList.length}件のワールド参加を記録しました\n${createdPlayerJoinLogModelList.length}件のプレイヤー参加を記録しました`,
  }).show();
};
