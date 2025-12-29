import { Settings } from 'lucide-react';
import { memo } from 'react';

import { Switch } from '@/components/ui/switch';
import { trpcReact } from '@/trpc';
import { useToast } from '../../hooks/use-toast';
import { useI18n } from '../../i18n/store';
import { SettingsItem, SettingsSection } from './common';

/**
 * 自動起動やバックグラウンド処理の設定を行う画面。
 * SettingsModal 内のシステムタブから利用される。
 */
const SystemSettings = memo(() => {
  const { t } = useI18n();
  const { toast } = useToast();
  const utils = trpcReact.useContext();

  const { data: startupLaunch, isLoading: isStartupLoading } =
    trpcReact.backgroundSettings.getIsAppAutoStartEnabled.useQuery();
  const { mutate: setStartupLaunch, isPending: isStartupUpdating } =
    trpcReact.backgroundSettings.setIsAppAutoStartEnabled.useMutation({
      onMutate: async (newValue) => {
        await utils.backgroundSettings.getIsAppAutoStartEnabled.cancel();
        const previousValue =
          utils.backgroundSettings.getIsAppAutoStartEnabled.getData();
        utils.backgroundSettings.getIsAppAutoStartEnabled.setData(
          undefined,
          newValue,
        );
        return { previousValue };
      },
      onError: (err, _newValue, context) => {
        utils.backgroundSettings.getIsAppAutoStartEnabled.setData(
          undefined,
          context?.previousValue,
        );
        console.error('Failed to update startup launch setting:', err);
        toast({
          title: t('settings.system.startupLaunch'),
          description: t('settings.system.startupError'),
          variant: 'destructive',
        });
      },
      onSuccess: () => {
        toast({
          title: t('settings.system.startupLaunch'),
          description: t('settings.system.startupSuccess'),
        });
      },
      onSettled: () => {
        utils.backgroundSettings.getIsAppAutoStartEnabled.invalidate();
      },
    });

  const { data: backgroundUpdate } =
    trpcReact.backgroundSettings.getIsBackgroundFileCreationEnabled.useQuery();
  const { mutate: setBackgroundUpdate } =
    trpcReact.backgroundSettings.setIsBackgroundFileCreationEnabled.useMutation(
      {
        onSuccess: () => {
          utils.backgroundSettings.getIsBackgroundFileCreationEnabled.invalidate();
        },
      },
    );

  return (
    <SettingsSection icon={Settings} title={t('settings.system.title')}>
      <div className="space-y-4">
        <SettingsItem
          label={t('settings.system.startupLaunch')}
          description={t('settings.system.startupDescription')}
          disabled={isStartupLoading || isStartupUpdating}
        >
          <Switch
            checked={startupLaunch ?? false}
            onCheckedChange={setStartupLaunch}
            disabled={isStartupLoading || isStartupUpdating}
            aria-label={t('settings.system.startupLaunch')}
          />
        </SettingsItem>

        <SettingsItem
          label={t('settings.system.backgroundUpdate')}
          description={t('settings.system.backgroundDescription')}
        >
          <Switch
            checked={backgroundUpdate ?? false}
            onCheckedChange={setBackgroundUpdate}
            aria-label={t('settings.system.backgroundUpdate')}
          />
        </SettingsItem>
      </div>
    </SettingsSection>
  );
});

SystemSettings.displayName = 'SystemSettings';

export default SystemSettings;
