import {
  Download,
  FileText,
  FolderOpen,
  Globe2,
  Settings as SettingsIcon,
  Sun,
  Upload,
} from 'lucide-react';
import type React from 'react';
import { memo, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
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
  icon: React.ComponentType<{ className?: string }>;
  component: React.ComponentType;
}

/**
 * 各種設定タブをまとめたモーダルダイアログ。
 * AppHeader から開かれ、パス設定やテーマ設定などを切り替えて表示する。
 */
const SettingsModal = memo(({ onClose }: SettingsModalProps) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>('paths');

  const tabs: TabConfig[] = [
    {
      id: 'paths',
      label: t('settings.tabs.dataSource'),
      icon: FolderOpen,
      component: () => <PathSettings showRefreshAll />,
    },
    {
      id: 'system',
      label: t('settings.tabs.system'),
      icon: SettingsIcon,
      component: SystemSettings,
    },
    {
      id: 'theme',
      label: t('settings.tabs.theme'),
      icon: Sun,
      component: ThemeSelector,
    },
    {
      id: 'language',
      label: 'Language / 言語',
      icon: Globe2,
      component: LanguageSelector,
    },
    {
      id: 'export',
      label: 'データエクスポート',
      icon: Download,
      component: DataExport,
    },
    {
      id: 'import',
      label: 'データインポート',
      icon: Upload,
      component: DataImport,
    },
    {
      id: 'info',
      label: t('settings.tabs.info'),
      icon: SettingsIcon,
      component: () => (
        <div className="space-y-8">
          <AppInfo />
        </div>
      ),
    },
    {
      id: 'license',
      label: t('settings.tabs.license'),
      icon: FileText,
      component: LicenseInfo,
    },
  ];

  const ActiveComponent =
    tabs.find((tab) => tab.id === activeTab)?.component ?? tabs[0].component;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="h-[85vh] w-[880px] max-w-[880px] p-0 overflow-hidden">
        {/* ヘッダー — 圧倒的余白の中にタイトルだけ */}
        <DialogHeader className="px-14 pt-14 pb-4">
          <DialogTitle className="text-lg font-medium tracking-tight text-foreground/80">
            {t('common.settings')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex h-[calc(85vh-100px)]">
          {/* サイドバー — 広い余白、タブ間にゆとり */}
          <div className="flex-none w-56">
            <nav
              className="flex flex-col px-7 pt-4 space-y-0.5"
              aria-label="Tabs"
            >
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  type="button"
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`relative py-2 px-3 flex items-center text-[13px] transition-all duration-200 ease-spring rounded-lg ${
                    activeTab === id
                      ? 'text-foreground bg-muted/40'
                      : 'text-muted-foreground/50 hover:text-foreground/80 hover:bg-muted/20'
                  }`}
                >
                  <Icon className="h-[14px] w-[14px] mr-3 flex-shrink-0 opacity-40" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* コンテンツ — 空間の中に要素が浮いている */}
          <div className="flex-1 overflow-y-auto px-14 py-10">
            <ActiveComponent />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

SettingsModal.displayName = 'SettingsModal';

export default SettingsModal;
