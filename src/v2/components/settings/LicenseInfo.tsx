import { Book } from 'lucide-react';
import { memo } from 'react';
import licenseJsonFile from '@/assets/licenses.json';
import { useI18n } from '../../i18n/store';

interface LibraryMetadata {
  name: string;
  licenses: string;
  repository?: string;
  publisher?: string;
  email?: string;
  url?: string;
  path: string;
  licenseFile?: string;
}

/**
 * 使用している OSS ライブラリのライセンス一覧を表示する設定項目。
 * SettingsModal の「ライセンス」タブで利用される。
 */
const LicenseInfo = memo(() => {
  const { t } = useI18n();

  const licenseFileRawData = licenseJsonFile as {
    [key: string]: Omit<LibraryMetadata, 'name'>;
  };

  const libraries = Object.keys(licenseFileRawData).map((key) => ({
    ...licenseFileRawData[key],
    name: key,
  }));

  return (
    <section>
      <h3 className="flex items-center text-lg font-medium text-gray-900 dark:text-white mb-4">
        <Book className="h-5 w-5 mr-2 text-indigo-600 dark:text-indigo-400" />
        {t('settings.info.licenses.title')}
      </h3>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {libraries.map((lib) => (
          <div key={lib.path} className="py-3">
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-gray-900 dark:text-white">
                {lib.name}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {lib.licenses}
              </span>
            </div>
            {lib.repository && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">
                  Repository
                </span>
                <a
                  href={lib.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
                >
                  {lib.repository}
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
});

LicenseInfo.displayName = 'LicenseInfo';

export default LicenseInfo;
