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
      <DialogContent className="h-[85vh] w-[840px] max-w-[840px] p-0 overflow-hidden">
        {/* ヘッダー — ミニマル、余白で存在感 */}
        <DialogHeader className="px-10 pt-10 pb-4">
          <DialogTitle className="text-xl font-semibold tracking-tight">
            {t('common.settings')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex h-[calc(85vh-90px)]">
          {/* サイドバー — 広い余白、ゆったりしたタブ */}
          <div className="flex-none w-52">
            <nav
              className="flex flex-col px-5 py-3 space-y-0.5"
              aria-label="Tabs"
            >
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  type="button"
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`relative py-2.5 px-4 flex items-center text-[13px] font-medium transition-all duration-200 ease-spring rounded-xl ${
                    activeTab === id
                      ? 'text-foreground bg-muted/60'
                      : 'text-muted-foreground/70 hover:text-foreground hover:bg-muted/30'
                  }`}
                >
                  <Icon className="h-4 w-4 mr-3.5 flex-shrink-0 opacity-60" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* コンテンツ — 広大な余白でエレガントに */}
          <div className="flex-1 overflow-y-auto px-10 py-6">
            <ActiveComponent />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

SettingsModal.displayName = 'SettingsModal';

export default SettingsModal;
