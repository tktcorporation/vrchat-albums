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
      <DialogContent className="h-[85vh] w-[860px] max-w-[860px] p-0 overflow-hidden">
        {/* ヘッダー — たっぷりの余白で「設定」の一語だけが静かに存在 */}
        <DialogHeader className="px-12 pt-12 pb-6">
          <DialogTitle className="text-xl font-semibold tracking-tight">
            {t('common.settings')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex h-[calc(85vh-100px)]">
          {/* サイドバー — Arc風：ゆったり、各タブ間に余裕 */}
          <div className="flex-none w-52">
            <nav
              className="flex flex-col px-6 py-2 space-y-1"
              aria-label="Tabs"
            >
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  type="button"
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`relative py-2 px-3 flex items-center text-[13px] transition-all duration-200 ease-spring rounded-lg ${
                    activeTab === id
                      ? 'text-foreground font-medium bg-muted/50'
                      : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/25'
                  }`}
                >
                  <Icon className="h-[15px] w-[15px] mr-3 flex-shrink-0 opacity-50" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* コンテンツ — 圧倒的な余白。Arc のように内容が空間に浮いている感覚 */}
          <div className="flex-1 overflow-y-auto px-12 py-8">
            <ActiveComponent />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

SettingsModal.displayName = 'SettingsModal';

export default SettingsModal;
