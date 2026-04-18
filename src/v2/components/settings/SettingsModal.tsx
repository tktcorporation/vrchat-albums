import { memo, useState } from 'react';

import { cn } from '../../../components/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { OPTION_BUTTON } from '../../constants/ui';
import { useI18n } from '../../i18n/store';
import LanguageSelector from '../LanguageSelector';
import AppInfo from './AppInfo';
import DataExport from './DataExport';
import DataImport from './DataImport';
import LicenseInfo from './LicenseInfo';
import PathSettings from './PathSettings';
import SystemSettings from './SystemSettings';
import ThemeSelector from './ThemeSelector';

interface SettingsModalProps {
  onClose: () => void;
}

type SettingsTab =
  | 'paths'
  | 'theme'
  | 'language'
  | 'info'
  | 'license'
  | 'system'
  | 'export'
  | 'import';

interface TabConfig {
  id: SettingsTab;
  label: string;
  component: React.ComponentType;
}

/**
 * 各種設定タブをまとめたモーダルダイアログ。
 * AppHeader から開かれ、パス設定やテーマ設定などを切り替えて表示する。
 *
 * 「余白で語る」設計方針: タブは文字のみで構成し、装飾的なアイコンは置かない。
 * 選択状態は背景トーンと font-medium で表現する。
 */
const SettingsModal = memo(({ onClose }: SettingsModalProps) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>('paths');

  const tabs: TabConfig[] = [
    {
      id: 'paths',
      label: t('settings.tabs.dataSource'),
      component: () => <PathSettings showRefreshAll />,
    },
    {
      id: 'system',
      label: t('settings.tabs.system'),
      component: SystemSettings,
    },
    {
      id: 'theme',
      label: t('settings.tabs.theme'),
      component: ThemeSelector,
    },
    {
      id: 'language',
      label: 'Language / 言語',
      component: LanguageSelector,
    },
    {
      id: 'export',
      label: 'データエクスポート',
      component: DataExport,
    },
    {
      id: 'import',
      label: 'データインポート',
      component: DataImport,
    },
    {
      id: 'info',
      label: t('settings.tabs.info'),
      component: AppInfo,
    },
    {
      id: 'license',
      label: t('settings.tabs.license'),
      component: LicenseInfo,
    },
  ];

  const ActiveComponent =
    tabs.find((tab) => tab.id === activeTab)?.component ?? tabs[0].component;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="h-[88vh] w-[min(55rem,100svw-2rem)] p-0 glass-panel">
        <DialogHeader className="px-10 pt-8 pb-6">
          <DialogTitle className="text-2xl font-semibold tracking-tight">
            {t('common.settings')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex h-[calc(88vh-96px)] min-h-0">
          <div className="flex-none w-44 pl-6 pr-2 pb-8">
            <nav className="flex flex-col gap-0.5" aria-label="Tabs">
              {tabs.map(({ id, label }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    type="button"
                    key={id}
                    onClick={() => setActiveTab(id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'rounded-md px-3 py-2 text-left text-sm transition-colors',
                      isActive
                        ? OPTION_BUTTON.selectedStrong
                        : OPTION_BUTTON.default,
                    )}
                  >
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex-1 overflow-y-auto px-10 pb-12">
            <ActiveComponent />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

SettingsModal.displayName = 'SettingsModal';

export default SettingsModal;
