import {
  Calendar,
  CalendarRange,
  Download,
  FolderOpen,
  Infinity as InfinityIcon,
} from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import { cn } from '@/components/lib/utils';
import { trpcClient, trpcReact } from '@/trpc';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { SPACING, TEXT_COLOR, TYPOGRAPHY } from '../../constants/ui';
import { useToast } from '../../hooks/use-toast';
import { SettingsInfoBox, SettingsSection } from './common';

type PeriodPreset = 'all' | 'recent3months' | 'custom';

/**
 * ログデータのエクスポート機能を提供するコンポーネント
 * SettingsModal内のデータエクスポートタブから利用される
 */
const DataExport = memo(() => {
  const { toast } = useToast();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<PeriodPreset>('all');

  // コンポーネント初期化時にデフォルトパスを設定
  useEffect(() => {
    const setDefaultOutputPath = async () => {
      try {
        const downloadsPath =
          await trpcClient.electronUtil.getDownloadsPath.query();
        setOutputPath(downloadsPath);
      } catch (error) {
        console.error('Failed to get downloads path:', error);
      }
    };
    setDefaultOutputPath();
  }, []);

  const selectOutputDir = async () => {
    try {
      const dirPath = await trpcClient.electronUtil.openGetDirDialog.query();
      if (dirPath) {
        setOutputPath(dirPath);
      }
    } catch (error) {
      console.error('Failed to select directory:', error);
    }
  };

  const { mutate: exportLogStore, isPending: isExporting } =
    trpcReact.vrchatLog.exportLogStoreData.useMutation({
      onSuccess: (result) => {
        toast({
          title: 'エクスポート完了',
          description: `${result.exportedFiles.length}ファイル、${result.totalLogLines}行をエクスポートしました`,
          duration: 5000,
        });
      },
      onError: (error) => {
        toast({
          title: 'エクスポートエラー',
          description: error.message,
          variant: 'destructive',
          duration: 5000,
        });
      },
    });

  const handleExport = () => {
    // カスタム期間の場合は日付チェック
    if (selectedPreset === 'custom') {
      if (!startDate || !endDate) {
        toast({
          title: '入力エラー',
          description:
            '期間指定を選択した場合は開始日と終了日を指定してください',
          variant: 'destructive',
        });
        return;
      }

      // フロントエンドの日付をローカルタイムとして解釈
      // startDate: その日の00:00:00 (ローカルタイム)
      // endDate: その日の23:59:59.999 (ローカルタイム)
      const start = new Date(`${startDate}T00:00:00`);
      const end = new Date(`${endDate}T23:59:59.999`);

      if (start >= end) {
        toast({
          title: '入力エラー',
          description: '開始日は終了日より前の日付を指定してください',
          variant: 'destructive',
        });
        return;
      }

      exportLogStore({
        startDate: start,
        endDate: end,
        outputPath: outputPath || undefined,
      });
    } else if (selectedPreset === 'recent3months') {
      // 過去3ヶ月の場合
      const end = new Date();
      const start = new Date();
      start.setMonth(start.getMonth() - 3);

      exportLogStore({
        startDate: start,
        endDate: end,
        outputPath: outputPath || undefined,
      });
    } else {
      // 全期間指定の場合は日付パラメータなしでエクスポート
      exportLogStore({
        outputPath: outputPath || undefined,
      });
    }
  };

  const handlePresetSelect = (preset: PeriodPreset) => {
    setSelectedPreset(preset);
    // カスタム期間以外の場合は日付をクリア
    if (preset !== 'custom') {
      setStartDate('');
      setEndDate('');
    }
  };

  const periodPresets = [
    { value: 'all' as const, label: '全期間', icon: InfinityIcon },
    { value: 'recent3months' as const, label: '過去3ヶ月', icon: Calendar },
    { value: 'custom' as const, label: 'カスタム期間', icon: CalendarRange },
  ];

  return (
    <SettingsSection
      icon={Download}
      title="ログデータエクスポート"
      description="データベースからlogStore形式でログデータをエクスポートします"
    >
      <div className={SPACING.stack.relaxed}>
        {/* 期間設定 */}
        <div className={SPACING.stack.default}>
          <Label
            className={`${TYPOGRAPHY.body.emphasis} ${TEXT_COLOR.secondary}`}
          >
            エクスポート期間
          </Label>

          {/* プリセット選択 - ThemeSelectorパターン */}
          <div className="grid grid-cols-3 gap-3">
            {periodPresets.map(({ value, label, icon: Icon }) => (
              <button
                type="button"
                key={value}
                onClick={() => handlePresetSelect(value)}
                className={cn(
                  'flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-colors',
                  selectedPreset === value
                    ? 'border-primary bg-primary/10 dark:bg-primary/20'
                    : 'border-border hover:border-primary/50',
                )}
              >
                <Icon
                  className={cn(
                    'h-5 w-5',
                    selectedPreset === value
                      ? 'text-primary'
                      : TEXT_COLOR.muted,
                  )}
                />
                <span
                  className={cn(
                    TYPOGRAPHY.body.emphasis,
                    selectedPreset === value
                      ? 'text-primary'
                      : TEXT_COLOR.secondary,
                  )}
                >
                  {label}
                </span>
              </button>
            ))}
          </div>

          {/* カスタム期間入力 - カスタム選択時のみ表示 */}
          {selectedPreset === 'custom' && (
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <Label
                  htmlFor="startDate"
                  className={`${TYPOGRAPHY.body.small} ${TEXT_COLOR.secondary}`}
                >
                  開始日
                </Label>
                <div className="relative">
                  <Calendar
                    className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 ${TEXT_COLOR.muted}`}
                  />
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div>
                <Label
                  htmlFor="endDate"
                  className={`${TYPOGRAPHY.body.small} ${TEXT_COLOR.secondary}`}
                >
                  終了日
                </Label>
                <div className="relative">
                  <Calendar
                    className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 ${TEXT_COLOR.muted}`}
                  />
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 出力パス設定 */}
        <div className={SPACING.stack.tight}>
          <Label
            htmlFor="outputPath"
            className={`${TYPOGRAPHY.body.emphasis} ${TEXT_COLOR.secondary}`}
          >
            出力先ディレクトリ（オプション）
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <FolderOpen
                className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 ${TEXT_COLOR.muted}`}
              />
              <Input
                id="outputPath"
                type="text"
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                placeholder="デフォルトはダウンロードフォルダ内のlogStoreディレクトリ"
                className="pl-10"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={selectOutputDir}
              className="flex-shrink-0"
            >
              参照
            </Button>
          </div>
          <p className={`${TYPOGRAPHY.body.small} ${TEXT_COLOR.muted}`}>
            出力先を変更しない場合、ダウンロードフォルダ内のlogStoreディレクトリに出力されます
          </p>
        </div>

        {/* エクスポートボタン */}
        <div className="pt-4">
          <Button
            onClick={handleExport}
            disabled={
              isExporting ||
              (selectedPreset === 'custom' && (!startDate || !endDate))
            }
            className="w-full"
          >
            <Download className="h-4 w-4 mr-2" />
            {isExporting ? 'エクスポート中...' : 'エクスポート開始'}
          </Button>
        </div>

        {/* 説明 */}
        <SettingsInfoBox title="エクスポート形式について" variant="info">
          <ul className={`${TYPOGRAPHY.body.small} space-y-1`}>
            <li>• データベースからlogStore形式でエクスポートします</li>
            <li>• 月別にファイルが分割されます（例: logStore-2023-10.txt）</li>
            <li>• ワールド参加、プレイヤー参加/退出ログが含まれます</li>
            <li>• 時系列順でソートされた形式で出力されます</li>
          </ul>
        </SettingsInfoBox>
      </div>
    </SettingsSection>
  );
});

DataExport.displayName = 'DataExport';

export default DataExport;
