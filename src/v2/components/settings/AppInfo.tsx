import { Effect } from 'effect';
import {
  ArrowUpRight,
  CheckCircle,
  Download,
  Info,
  RefreshCw,
} from 'lucide-react';
import type React from 'react';
import { memo, useCallback, useState } from 'react';

import { cn } from '@/components/lib/utils';
import { trpcClient, trpcReact } from '@/trpc';

import packageJson from '../../../../package.json';
import { Button } from '../../../components/ui/button';
import { ICON_SIZE, STATUS_COLOR, TYPOGRAPHY } from '../../constants/ui';
import { useI18n } from '../../i18n/store';
import { SettingsSection } from './common';
import SqliteConsole from './SqliteConsole';

/** アップデートチェック時のエラー型 */
interface UpdateCheckError {
  type: 'UPDATE_CHECK_FAILED';
}

/**
 * アップデートチェックの UI 状態。
 * 不正な状態の組み合わせを型レベルで防ぐために Union 型で定義。
 */
type UpdateCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'downloaded' }
  | { status: 'up-to-date' }
  | { status: 'error' };

/**
 * アプリのバージョンやログフォルダを表示する設定項目。
 * SettingsModal 内で使用され、隠し機能として SQL コンソールの起動も行う。
 * アップデートの確認・インストール機能も提供する。
 */
const AppInfo = memo(() => {
  const { t } = useI18n();
  const { mutate: openLog } = trpcReact.openElectronLogOnExplorer.useMutation();
  const { data: appVersion } = trpcReact.settings.getAppVersion.useQuery();
  const [_clickCount, setClickCount] = useState(0);
  const [showSqlConsole, setShowSqlConsole] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateCheckState>({
    status: 'idle',
  });

  /**
   * アップデートを確認し、結果に応じて状態を更新する。
   * tRPC クライアント呼び出しを Effect.tryPromise でラップし、
   * エラーを UpdateCheckError として型安全に伝播する。
   */
  const handleCheckForUpdates = useCallback(() => {
    setUpdateState({ status: 'checking' });

    type CheckResult =
      | { status: 'up-to-date' }
      | { status: 'available'; version: string }
      | { status: 'downloaded' };

    const checkEffect: Effect.Effect<CheckResult, UpdateCheckError> =
      Effect.tryPromise({
        try: () => trpcClient.settings.checkForUpdatesAndReturnResult.query(),
        catch: (): UpdateCheckError => ({ type: 'UPDATE_CHECK_FAILED' }),
      }).pipe(
        Effect.flatMap(
          (result): Effect.Effect<CheckResult, UpdateCheckError> => {
            if (!result.isUpdateAvailable || !result.updateInfo) {
              return Effect.succeed({ status: 'up-to-date' });
            }
            const version = result.updateInfo.updateInfo.version;
            // autoDownload=true なので、チェック後すぐにダウンロードが始まる。
            // ダウンロード済みかどうかを確認して表示を分ける。
            return Effect.tryPromise({
              try: () => trpcClient.updater.getUpdateStatus.query(),
              catch: (): UpdateCheckError => ({
                type: 'UPDATE_CHECK_FAILED',
              }),
            }).pipe(
              Effect.map((downloadStatus) =>
                downloadStatus.updateDownloaded
                  ? { status: 'downloaded' as const }
                  : { status: 'available' as const, version },
              ),
            );
          },
        ),
      );

    const program = checkEffect.pipe(
      Effect.match({
        onSuccess: (state) => setUpdateState(state),
        onFailure: () => setUpdateState({ status: 'error' }),
      }),
    );

    void Effect.runPromise(program);
  }, []);

  const { mutate: quitAndInstall, isPending: isInstalling } =
    trpcReact.updater.quitAndInstall.useMutation();

  /** ログフォルダをエクスプローラーで開く */
  const handleOpenLog = () => {
    openLog();
  };

  /** バージョン番号クリックで隠し機能を起動する */
  const handleVersionClick = () => {
    setClickCount((prev) => {
      const newCount = prev + 1;
      if (newCount === 7) {
        setShowSqlConsole(true);
        return 0;
      }
      return newCount;
    });
  };

  /** バージョン要素のキーボード操作を処理する */
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleVersionClick();
    }
  };

  return (
    <SettingsSection icon={Info} title={t('settings.info.title')}>
      <div className="space-y-5">
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">
            {t('settings.info.version')}
          </span>
          <button
            type="button"
            className="font-mono text-sm text-foreground cursor-pointer appearance-none border-none bg-transparent p-0"
            onClick={handleVersionClick}
            onKeyDown={handleKeyDown}
          >
            {appVersion}
          </button>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">
            {t('settings.info.name')}
          </span>
          <span className="font-mono text-sm text-foreground">
            {packageJson.name}
          </span>
        </div>

        {/* アップデートセクション */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {t('settings.info.update.checkForUpdates')}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheckForUpdates}
              disabled={updateState.status === 'checking'}
            >
              {updateState.status === 'checking' ? (
                <RefreshCw className={cn(ICON_SIZE.sm.class, 'animate-spin')} />
              ) : (
                <RefreshCw className={ICON_SIZE.sm.class} />
              )}
            </Button>
          </div>

          {/* アップデートステータス表示 */}
          {updateState.status === 'checking' && (
            <p className={TYPOGRAPHY.caption.default}>
              {t('settings.info.update.checking')}
            </p>
          )}
          {updateState.status === 'up-to-date' && (
            <div
              className={cn(
                'flex items-center gap-1.5',
                TYPOGRAPHY.caption.default,
                STATUS_COLOR.success.text,
              )}
            >
              <CheckCircle className={ICON_SIZE.xs.class} />
              <span>{t('settings.info.update.upToDate')}</span>
            </div>
          )}
          {updateState.status === 'available' && (
            <div className="flex flex-col gap-2">
              <div
                className={cn(
                  'flex items-center gap-1.5',
                  TYPOGRAPHY.caption.default,
                  STATUS_COLOR.info.text,
                )}
              >
                <Download className={ICON_SIZE.xs.class} />
                <span>
                  {t('settings.info.update.available').replace(
                    '{version}',
                    updateState.version,
                  )}
                </span>
              </div>
            </div>
          )}
          {updateState.status === 'downloaded' && (
            <div className="flex flex-col gap-2">
              <div
                className={cn(
                  'flex items-center gap-1.5',
                  TYPOGRAPHY.caption.default,
                  STATUS_COLOR.success.text,
                )}
              >
                <CheckCircle className={ICON_SIZE.xs.class} />
                <span>{t('settings.info.update.downloaded')}</span>
              </div>
              <Button
                variant="default"
                size="sm"
                onClick={() => quitAndInstall()}
                disabled={isInstalling}
              >
                {t('settings.info.update.installAndRestart')}
              </Button>
            </div>
          )}
          {updateState.status === 'error' && (
            <p
              className={cn(
                TYPOGRAPHY.caption.default,
                STATUS_COLOR.error.text,
              )}
            >
              {t('settings.info.update.checkFailed')}
            </p>
          )}
        </div>

        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">
            {t('settings.info.openLog')}
          </span>
          <Button variant="outline" size="sm" onClick={handleOpenLog}>
            <span className="sr-only">{t('settings.info.openLog')}</span>
            <ArrowUpRight className={ICON_SIZE.sm.class} />
          </Button>
        </div>
      </div>

      <SqliteConsole
        isOpen={showSqlConsole}
        onClose={() => setShowSqlConsole(false)}
      />
    </SettingsSection>
  );
});

AppInfo.displayName = 'AppInfo';

export default AppInfo;
