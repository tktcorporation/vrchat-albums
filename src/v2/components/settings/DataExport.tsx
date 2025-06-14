import { trpcClient, trpcReact } from '@/trpc';
import { Calendar, Download, FolderOpen } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { useToast } from '../../hooks/use-toast';

/**
 * ログデータのエクスポート機能を提供するコンポーネント
 * SettingsModal内のデータエクスポートタブから利用される
 */
const DataExport = memo(() => {
  const { toast } = useToast();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [outputPath, setOutputPath] = useState('');

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

  const { mutate: exportLogStore, isLoading: isExporting } =
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
    if (!startDate || !endDate) {
      toast({
        title: '入力エラー',
        description: '開始日と終了日を指定してください',
        variant: 'destructive',
      });
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

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
  };

  const setDateRange = (months: number) => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);

    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  };

  const setAllTimeRange = () => {
    // 十分に古い日付から現在まで（VRChatは2017年リリース）
    const start = new Date('2017-01-01');
    const end = new Date();

    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
          ログデータエクスポート
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          データベースからlogStore形式でログデータをエクスポートします
        </p>
      </div>

      <div className="space-y-4">
        {/* 期間設定 */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">エクスポート期間</Label>

          {/* プリセットボタン */}
          <div className="flex gap-2 flex-wrap">
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAllTimeRange()}
              className="text-xs"
            >
              全期間
            </Button>
          </div>

          {/* 日付入力 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label
                htmlFor="startDate"
                className="text-xs text-gray-600 dark:text-gray-400"
              >
                開始日
              </Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
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
                className="text-xs text-gray-600 dark:text-gray-400"
              >
                終了日
              </Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
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
        </div>

        {/* 出力パス設定 */}
        <div className="space-y-2">
          <Label htmlFor="outputPath" className="text-sm font-medium">
            出力先ディレクトリ（オプション）
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <FolderOpen className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
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
          <p className="text-xs text-gray-500 dark:text-gray-400">
            出力先を変更しない場合、ダウンロードフォルダ内のlogStoreディレクトリに出力されます
          </p>
        </div>

        {/* エクスポートボタン */}
        <div className="pt-4">
          <Button
            onClick={handleExport}
            disabled={isExporting || !startDate || !endDate}
            className="w-full"
          >
            <Download className="h-4 w-4 mr-2" />
            {isExporting ? 'エクスポート中...' : 'エクスポート開始'}
          </Button>
        </div>

        {/* 説明 */}
        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
          <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
            エクスポート形式について
          </h4>
          <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1">
            <li>• データベースからlogStore形式でエクスポートします</li>
            <li>• 月別にファイルが分割されます（例: logStore-2023-10.txt）</li>
            <li>• ワールド参加、プレイヤー参加/退出ログが含まれます</li>
            <li>• 時系列順でソートされた形式で出力されます</li>
          </ul>
        </div>
      </div>
    </div>
  );
});

DataExport.displayName = 'DataExport';

export default DataExport;
