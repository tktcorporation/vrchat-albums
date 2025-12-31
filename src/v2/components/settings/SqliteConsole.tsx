import { Database, Play } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { trpcReact } from '@/trpc';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { useI18n } from '../../i18n/store';

interface SqliteConsoleProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * デバッグ目的で SQLite に直接クエリを実行するためのコンソール。
 * AppInfo から特定の操作で開かれる隠し機能となっている。
 */
const SqliteConsole: React.FC<SqliteConsoleProps> = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('');
  const [isDebugLogEnabled, setIsDebugLogEnabled] = useState(false);
  const { mutateAsync: executeQuery, isPending: isExecutingQuery } =
    trpcReact.debug.executeSqlite.useMutation();
  const { data: currentLogLevel, isLoading: isLoadingLogLevel } =
    trpcReact.debug.getLogLevel.useQuery(undefined, { enabled: isOpen });
  const { mutate: setLogLevel, isPending: isSettingLogLevel } =
    trpcReact.debug.setLogLevel.useMutation();
  const { mutateAsync: throwErrorForSentryTest, isPending: isThrowingError } =
    trpcReact.settings.throwErrorForSentryTest.useMutation();

  useEffect(() => {
    if (currentLogLevel) {
      setIsDebugLogEnabled(currentLogLevel === 'debug');
    }
  }, [currentLogLevel]);

  const sampleQueries = [
    {
      label: 'テーブル一覧',
      query: "SELECT name FROM sqlite_master WHERE type='table'",
    },
    {
      label: 'プレイヤー参加ログ',
      query:
        'SELECT * FROM VRChatPlayerJoinLogModels ORDER BY joinDateTime DESC LIMIT 10',
    },
    {
      label: 'プレイヤー退出ログ',
      query:
        'SELECT * FROM VRChatPlayerLeaveLogModels ORDER BY leaveDateTime DESC LIMIT 10',
    },
    {
      label: 'ワールド訪問履歴',
      query:
        'SELECT * FROM VRChatWorldJoinLogModels ORDER BY joinDateTime DESC LIMIT 10',
    },
  ];

  /**
   * 入力されたSQLクエリを実行して結果を表示するハンドラー。
   * 実行ボタンやショートカットキーから呼び出される。
   */
  const handleExecute = async () => {
    if (!query.trim()) return;

    try {
      const result = await executeQuery({ query });
      setResult(JSON.stringify(result, null, 2));
    } catch (error) {
      setResult(String(error));
    }
  };

  /**
   * テキストエリアで Cmd/Ctrl+Enter を押した際にクエリを実行する。
   */
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handleExecute();
    }
  };

  /**
   * デバッグログ出力の有無を切り替えるチェックボックス用ハンドラー。
   */
  const handleDebugLogChange = (checked: boolean | 'indeterminate') => {
    const newLevel = checked ? 'debug' : 'info';
    setIsDebugLogEnabled(Boolean(checked));
    setLogLevel({ level: newLevel });
  };

  /**
   * Sentry 連携をテストするため意図的にエラーを投げる関数。
   */
  const handleThrowError = async () => {
    try {
      await throwErrorForSentryTest();
      setResult(t('debug.sqliteConsole.errorThrownSuccess'));
    } catch (error) {
      setResult(String(error));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[800px] h-[80vh] flex flex-col gap-0 p-0 bg-popover">
        <DialogHeader className="px-6 py-4 border-b border-border">
          <DialogTitle className="flex items-center text-xl font-semibold text-foreground">
            <Database className="h-5 w-5 mr-2 text-info" />
            {t('debug.sqliteConsole.title') || 'SQLite Console'}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 border-b border-border flex items-center space-x-2">
          <Checkbox
            id="debug-log-enable"
            checked={isDebugLogEnabled}
            onCheckedChange={handleDebugLogChange}
            disabled={isLoadingLogLevel || isSettingLogLevel}
          />
          <Label
            htmlFor="debug-log-enable"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            {t('debug.sqliteConsole.enableDebugLog' as const) ||
              'Enable Debug Log'}
          </Label>
        </div>

        <div className="px-6 py-4 border-b border-border">
          <Button
            onClick={handleThrowError}
            disabled={isThrowingError}
            variant="destructive"
          >
            {t('debug.sqliteConsole.throwErrorButton') || 'Throw Test Error'}
          </Button>
        </div>

        <div className="flex-1 flex flex-col gap-4 p-6 overflow-hidden">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="query"
                className="text-sm font-medium text-muted-foreground"
              >
                {t('debug.sqliteConsole.queryLabel') || 'SQL Query'}
              </label>
              <span className="text-xs text-muted-foreground/80">
                {t('debug.sqliteConsole.shortcut') ||
                  'Press Cmd/Ctrl + Enter to execute'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {sampleQueries.map((sample) => (
                <Button
                  key={sample.label}
                  variant="outline"
                  size="sm"
                  onClick={() => setQuery(sample.query)}
                  className="text-xs"
                >
                  {sample.label}
                </Button>
              ))}
            </div>
            <div className="relative">
              <Textarea
                id="query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  t('debug.sqliteConsole.placeholder') || 'Enter SQL query...'
                }
                className="font-mono text-sm min-h-[120px] resize-none bg-background border-border text-foreground placeholder-muted-foreground"
              />
              <Button
                size="sm"
                onClick={handleExecute}
                disabled={isExecutingQuery || !query.trim()}
                className="absolute bottom-2 right-2"
              >
                <Play className="h-4 w-4 mr-1" />
                {t('debug.sqliteConsole.execute') || '実行'}
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col gap-2">
            <label className="text-sm font-medium text-muted-foreground">
              {t('debug.sqliteConsole.resultLabel') || 'Result'}
            </label>
            <div className="flex-1 overflow-auto rounded-lg bg-muted">
              <pre className="h-full p-4 font-mono text-sm text-foreground">
                {result ||
                  t('debug.sqliteConsole.noResult') ||
                  'Results will appear here...'}
              </pre>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SqliteConsole;
