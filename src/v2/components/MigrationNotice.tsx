import { useEffect, useState } from 'react';
import { trpcReact } from '@/trpc';
import { useToast } from '@/v2/hooks/use-toast';
import { MigrationDialog } from './MigrationDialog';

/**
 * Migration notice hook that manages migration dialog and notifications
 */
export const useMigrationNotice = () => {
  const { toast } = useToast();
  const [showMigrationDialog, setShowMigrationDialog] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // 初期化を遅延実行（アプリの起動を妨げない）
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsInitializing(false);
    }, 2000); // 2秒後に初期化開始

    return () => clearTimeout(timer);
  }, []);

  const { data: migrationStatus, refetch: refetchMigrationStatus } =
    trpcReact.settings.checkMigrationStatus.useQuery(undefined, {
      // 初期化が完了してから実行
      enabled: !isInitializing,
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
    });

  const { data: migrationNoticeShown, isLoading: isLoadingNoticeShown } =
    trpcReact.settings.getMigrationNoticeShown.useQuery(undefined, {
      enabled: !isInitializing,
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
    });

  const setMigrationNoticeShown =
    trpcReact.settings.setMigrationNoticeShown.useMutation();

  useEffect(() => {
    // 初期化中はスキップ
    if (isInitializing || isLoadingNoticeShown || !migrationStatus) {
      return;
    }

    // 移行が必要で、まだ通知を表示していない場合
    const shouldShowDialog =
      migrationStatus.migrationNeeded === true && !migrationNoticeShown;

    if (shouldShowDialog) {
      setShowMigrationDialog(true);
    }
  }, [
    migrationStatus,
    migrationNoticeShown,
    isLoadingNoticeShown,
    isInitializing,
  ]);

  const handleMigrationComplete = async () => {
    // Mark the notice as shown after successful migration
    await setMigrationNoticeShown.mutateAsync();

    // Refetch migration status to update UI
    await refetchMigrationStatus();

    // Close the dialog
    setShowMigrationDialog(false);

    toast({
      title: 'データ移行完了',
      description: '旧アプリのデータが正常に移行されました。',
    });
  };

  const handleMigrationCancel = () => {
    // Mark the notice as shown when user cancels
    setMigrationNoticeShown.mutate();

    setShowMigrationDialog(false);

    toast({
      title: 'データ移行をスキップしました',
      duration: 5000,
    });
  };

  return {
    showMigrationDialog,
    handleMigrationComplete,
    handleMigrationCancel,
    MigrationDialog: () => (
      <MigrationDialog
        open={showMigrationDialog}
        onClose={handleMigrationCancel}
        onMigrationComplete={handleMigrationComplete}
      />
    ),
  };
};
