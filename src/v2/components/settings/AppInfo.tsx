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
import {
  ICON_SIZE,
  SPACING,
  STATUS_COLOR,
  SURFACE_COLOR,
  TEXT_COLOR,
  TYPOGRAPHY,
} from '../../constants/ui';
import { useI18n } from '../../i18n/store';
import { SettingsSection } from './common';
import SqliteConsole from './SqliteConsole';

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

  /** アップデートを確認し、結果に応じて状態を更新する */
  const handleCheckForUpdates = useCallback(() => {
    setUpdateState({ status: 'checking' });

    void (async () => {
      try {
        const result =
          await trpcClient.settings.checkForUpdatesAndReturnResult.query();

        if (result.isUpdateAvailable && result.updateInfo) {
          // autoDownload=true なので、チェック後すぐにダウンロードが始まる。
          // ダウンロード済みかどうかを確認して表示を分ける。
          const downloadStatus =
            await trpcClient.updater.getUpdateStatus.query();
          if (downloadStatus.updateDownloaded) {
            setUpdateState({ status: 'downloaded' });
          } else {
            setUpdateState({
              status: 'available',
              version: result.updateInfo.updateInfo.version,
            });
          }
        } else {
          setUpdateState({ status: 'up-to-date' });
        }
      } catch {
        setUpdateState({ status: 'error' });
      }
    })();
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
      <div
        className={`${SURFACE_COLOR.muted} rounded-lg ${SPACING.padding.card} ${SPACING.stack.tight}`}
      >
        <div className="flex justify-between">
          <span className={TEXT_COLOR.secondary}>
            {t('settings.info.version')}
          </span>
          <button
            type="button"
            className={`font-mono ${TEXT_COLOR.primary} cursor-pointer appearance-none border-none bg-transparent p-0`}
            onClick={handleVersionClick}
            onKeyDown={handleKeyDown}
          >
            {appVersion}
          </button>
        </div>
        <div className="flex justify-between">
          <span className={TEXT_COLOR.secondary}>
            {t('settings.info.name')}
          </span>
          <span className={`font-mono ${TEXT_COLOR.primary}`}>
            {packageJson.name}
          </span>
        </div>

        {/* アップデートセクション */}
        <div className="flex flex-col gap-2 mt-4">
          <div className="flex items-center justify-between">
            <span className={TEXT_COLOR.secondary}>
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

        <div className="flex justify-between mt-4">
          <span className={TEXT_COLOR.secondary}>
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
