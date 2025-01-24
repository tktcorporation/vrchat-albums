import { trpcReact } from '@/trpc';
import { ArrowUpRight, Info } from 'lucide-react';
import type React from 'react';
import { memo, useState } from 'react';
import packageJson from '../../../../package.json';
import { Button } from '../../../components/ui/button';
import { useI18n } from '../../i18n/store';
import SqliteConsole from './SqliteConsole';

const AppInfo = memo(() => {
  const { t } = useI18n();
  const { mutate: openLog } = trpcReact.openElectronLogOnExplorer.useMutation();
  const { data: appVersion } = trpcReact.settings.getAppVersion.useQuery();
  const [_clickCount, setClickCount] = useState(0);
  const [showSqlConsole, setShowSqlConsole] = useState(false);

  const handleOpenLog = () => {
    openLog();
  };

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

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleVersionClick();
    }
  };

  return (
    <section>
      <h3 className="flex items-center text-lg font-medium text-gray-900 dark:text-white mb-4">
        <Info className="h-5 w-5 mr-2 text-indigo-600 dark:text-indigo-400" />
        {t('settings.info.title')}
      </h3>
      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 space-y-2">
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">
            {t('settings.info.version')}
          </span>
          <span
            className="font-mono text-gray-900 dark:text-white cursor-pointer"
            onClick={handleVersionClick}
            onKeyDown={handleKeyDown}
            role="button"
            tabIndex={0}
          >
            {appVersion}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">
            {t('settings.info.name')}
          </span>
          <span className="font-mono text-gray-900 dark:text-white">
            {packageJson.name}
          </span>
        </div>
        <div className="flex justify-between mt-8">
          <span className="text-gray-600 dark:text-gray-400">
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
    </section>
  );
});

AppInfo.displayName = 'AppInfo';

export default AppInfo;
