import { Calendar, Download, FolderOpen } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import { trpcClient, trpcReact } from '@/trpc';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { SPACING, TEXT_COLOR, TYPOGRAPHY } from '../../constants/ui';
import { useToast } from '../../hooks/use-toast';
import { SettingsInfoBox, SettingsSection } from './common';

/**
 * ログデータのエクスポート機能を提供するコンポーネント
 * SettingsModal内のデータエクスポートタブから利用される
 */
const DataExport = memo(() => {
  const { toast } = useToast();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [useFullPeriod, setUseFullPeriod] = useState(true);

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
    // 全期間指定の場合は日付チェックをスキップ
    if (!useFullPeriod) {
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
    } else {
      // 全期間指定の場合は日付パラメータなしでエクスポート
      exportLogStore({
        outputPath: outputPath || undefined,
      });
    }
  };

  const setDateRange = (months: number) => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);

    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
    setUseFullPeriod(false);
  };

  const setAllTimeRange = () => {
    setUseFullPeriod(true);
    setStartDate('');
    setEndDate('');
  };

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

          {/* プリセットボタン */}
          <div className="flex gap-2 flex-wrap">
            <Button
              type="button"
              variant={useFullPeriod ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAllTimeRange()}
              className="text-xs"
            >
              全期間
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDateRange(1)}
              className="text-xs"
            >
              過去1ヶ月
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDateRange(3)}
              className="text-xs"
            >
              過去3ヶ月
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDateRange(6)}
              className="text-xs"
            >
              過去6ヶ月
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDateRange(12)}
              className="text-xs"
            >
              過去1年
            </Button>
          </div>

          {/* 日付入力 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label
                htmlFor="startDate"
                className={`${TYPOGRAPHY.body.small} ${
                  useFullPeriod ? TEXT_COLOR.muted : TEXT_COLOR.secondary
                }`}
              >
                開始日{useFullPeriod && ' (全期間選択時は無効)'}
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
                  disabled={useFullPeriod}
                  className="pl-10"
                />
              </div>
            </div>
            <div>
              <Label
                htmlFor="endDate"
                className={`${TYPOGRAPHY.body.small} ${
                  useFullPeriod ? TEXT_COLOR.muted : TEXT_COLOR.secondary
                }`}
              >
                終了日{useFullPeriod && ' (全期間選択時は無効)'}
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
                  disabled={useFullPeriod}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
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
              isExporting || (!useFullPeriod && (!startDate || !endDate))
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
