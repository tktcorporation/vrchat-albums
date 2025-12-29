import { Book } from 'lucide-react';
import { memo } from 'react';

import licenseJsonFile from '@/assets/licenses.json';
import { TEXT_COLOR, TYPOGRAPHY } from '../../constants/ui';
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

  const licenseFileRawData = licenseJsonFile as {
    [key: string]: Omit<LibraryMetadata, 'name'>;
  };

  const libraries = Object.keys(licenseFileRawData).map((key) => ({
    ...licenseFileRawData[key],
    name: key,
  }));

  return (
    <SettingsSection icon={Book} title={t('settings.info.licenses.title')}>
      <div className="divide-y divide-border">
        {libraries.map((lib) => (
          <div key={lib.path} className="py-3">
            <div className="flex items-center justify-between mb-1">
              <span
                className={`${TYPOGRAPHY.body.emphasis} ${TEXT_COLOR.primary}`}
              >
                {lib.name}
              </span>
              <span className={`${TYPOGRAPHY.body.small} ${TEXT_COLOR.muted}`}>
                {lib.licenses}
              </span>
            </div>
            {lib.repository && (
              <div
                className={`flex items-center justify-between ${TYPOGRAPHY.body.small}`}
              >
                <span className={TEXT_COLOR.secondary}>Repository</span>
                <a
                  href={lib.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80"
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
