import { ArrowUpRight, Info } from 'lucide-react';
import type React from 'react';
import { memo, useState } from 'react';

import { trpcReact } from '@/trpc';
import packageJson from '../../../../package.json';
import { Button } from '../../../components/ui/button';
import { SPACING, SURFACE_COLOR, TEXT_COLOR } from '../../constants/ui';
import { useI18n } from '../../i18n/store';
import { SettingsSection } from './common';
import SqliteConsole from './SqliteConsole';

/**
 * アプリのバージョンやログフォルダを表示する設定項目。
 * SettingsModal 内で使用され、隠し機能として SQL コンソールの起動も行う。
 */
const AppInfo = memo(() => {
  const { t } = useI18n();
  const { mutate: openLog } = trpcReact.openElectronLogOnExplorer.useMutation();
  const { data: appVersion } = trpcReact.settings.getAppVersion.useQuery();
  const [_clickCount, setClickCount] = useState(0);
  const [showSqlConsole, setShowSqlConsole] = useState(false);

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
          <span
            className={`font-mono ${TEXT_COLOR.primary} cursor-pointer`}
            onClick={handleVersionClick}
            onKeyDown={handleKeyDown}
            role="button"
            tabIndex={0}
          >
            {appVersion}
          </span>
        </div>
        <div className="flex justify-between">
          <span className={TEXT_COLOR.secondary}>
            {t('settings.info.name')}
          </span>
          <span className={`font-mono ${TEXT_COLOR.primary}`}>
            {packageJson.name}
          </span>
        </div>
        <div className="flex justify-between mt-8">
          <span className={TEXT_COLOR.secondary}>
            {t('settings.info.openLog')}
          </span>
          <Button variant="outline" size="sm" onClick={handleOpenLog}>
            <span className="sr-only">{t('settings.info.openLog')}</span>
            <ArrowUpRight className="h-4 w-4" />
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
