import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { trpcReact } from '@/trpc';
import { AlertCircle, ArrowRight, Database, FolderOpen } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { useToast } from '../hooks/use-toast';
import { useI18n } from '../i18n/store';

interface MigrationDialogProps {
  open: boolean;
  onClose: () => void;
  onMigrationComplete: () => void;
}

/**
 * 旧アプリからのデータ移行確認ダイアログ
 */
export const MigrationDialog: React.FC<MigrationDialogProps> = ({
  open,
  onClose,
  onMigrationComplete,
}) => {
  const { toast } = useToast();
  const { t } = useI18n();
  const [isProcessing, setIsProcessing] = useState(false);

  const performMigration = trpcReact.settings.performMigration.useMutation({
    onMutate: () => {
      setIsProcessing(true);
    },
    onSuccess: (result) => {
      // 移行された項目をリストアップ
      const migratedItems = [];
      if (result.details.database)
        migratedItems.push(t('migration.items.database'));
      if (result.details.logStore)
        migratedItems.push(t('migration.items.logStore'));
      if (result.details.settings)
        migratedItems.push(t('migration.items.settings'));

      toast({
        title: t('migration.toast.success'),
        description:
          migratedItems.length > 0
            ? t('migration.toast.successDetail').replace(
                '{items}',
                migratedItems.join('、'),
              )
            : t('migration.toast.success'),
      });
      onMigrationComplete();
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: t('migration.toast.error'),
        description: error.message,
      });
      setIsProcessing(false);
    },
  });

  const handleMigration = () => {
    performMigration.mutate();
  };

  const handleCancel = () => {
    if (!isProcessing) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleCancel}>
      <DialogContent className="max-w-[500px] bg-white dark:bg-gray-900">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t('migration.title')}
          </DialogTitle>
          <DialogDescription className="text-gray-600 dark:text-gray-400">
            {t('migration.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 移行の流れ */}
          <div className="flex items-center justify-center gap-4 py-4">
            <div className="flex flex-col items-center gap-2">
              <div className="w-16 h-16 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <FolderOpen className="h-8 w-8 text-gray-600 dark:text-gray-400" />
              </div>
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {t('migration.labels.oldApp')}
              </span>
            </div>
            <ArrowRight className="h-6 w-6 text-blue-500" />
            <div className="flex flex-col items-center gap-2">
              <div className="w-16 h-16 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <FolderOpen className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {t('migration.labels.newApp')}
              </span>
            </div>
          </div>

          {/* 移行内容 */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Database className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t('migration.labels.dataToMigrate')}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {t('migration.labels.dataDescription')}
                </p>
              </div>
            </div>
          </div>

          {/* 注意事項 */}
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-lg p-4">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  {t('migration.labels.notes')}
                </p>
                <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1 ml-2">
                  <li>• {t('migration.labels.note1')}</li>
                  <li>• {t('migration.labels.note2')}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isProcessing}
            className="min-w-[100px]"
          >
            {t('migration.buttons.skip')}
          </Button>
          <Button
            onClick={handleMigration}
            disabled={isProcessing}
            className="min-w-[140px] bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isProcessing ? (
              <span className="flex items-center gap-2">
                <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t('migration.buttons.migrating')}
              </span>
            ) : (
              t('migration.buttons.migrate')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
