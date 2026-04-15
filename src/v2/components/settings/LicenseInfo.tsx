import { Book } from 'lucide-react';
import { memo } from 'react';

import licenseJsonFile from '@/assets/licenses.json';

import { useI18n } from '../../i18n/store';
import { SettingsSection } from './common';

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

  const licenseFileRawData = licenseJsonFile as Record<
    string,
    Omit<LibraryMetadata, 'name'>
  >;

  const libraries = Object.keys(licenseFileRawData).map((key) => ({
    ...licenseFileRawData[key],
    name: key,
  }));

  return (
    <SettingsSection icon={Book} title={t('settings.info.licenses.title')}>
      <div className="space-y-1">
        {libraries.map((lib) => (
          <div
            key={lib.path}
            className="py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors duration-150"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                {lib.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {lib.licenses}
              </span>
            </div>
            {lib.repository && (
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-xs text-muted-foreground">
                  Repository
                </span>
                <a
                  href={lib.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary/70 hover:text-primary transition-colors"
                >
                  {lib.repository}
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
    </SettingsSection>
  );
});

LicenseInfo.displayName = 'LicenseInfo';

export default LicenseInfo;
