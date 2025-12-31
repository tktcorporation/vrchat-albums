import { AlertCircle, ArrowRight, Database, FolderOpen } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
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
      <DialogContent className="max-w-[500px] bg-popover">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground">
            {t('migration.title')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('migration.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 移行の流れ */}
          <div className="flex items-center justify-center gap-4 py-4">
            <div className="flex flex-col items-center gap-2">
              <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center">
                <FolderOpen className="h-8 w-8 text-muted-foreground" />
              </div>
              <span className="text-xs text-muted-foreground">
                {t('migration.labels.oldApp')}
              </span>
            </div>
            <ArrowRight className="h-6 w-6 text-primary" />
            <div className="flex flex-col items-center gap-2">
              <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center">
                <FolderOpen className="h-8 w-8 text-primary" />
              </div>
              <span className="text-xs text-muted-foreground">
                {t('migration.labels.newApp')}
              </span>
            </div>
          </div>

          {/* 移行内容 */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Database className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">
                  {t('migration.labels.dataToMigrate')}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('migration.labels.dataDescription')}
                </p>
              </div>
            </div>
          </div>

          {/* 注意事項 */}
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-warning flex-shrink-0" />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium text-warning">
                  {t('migration.labels.notes')}
                </p>
                <ul className="text-xs text-warning/80 space-y-1 ml-2">
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
            className="min-w-[140px] bg-primary hover:bg-primary/90 text-primary-foreground"
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
