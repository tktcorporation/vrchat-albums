import { Toaster } from '@/components/ui/toaster';
import { trpcReact } from '@/trpc';
import TrpcWrapper from '@/trpcWrapper';
import { init as initSentry } from '@sentry/electron/renderer';
import { useEffect, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { ErrorBoundary } from './components/ErrorBoundary';
import PhotoGallery from './components/PhotoGallery';
import { TermsModal } from './components/TermsModal';
import PathSettings from './components/settings/PathSettings';
import { terms } from './constants/terms/ja';
import { ThemeProvider } from './contexts/ThemeContext';
import { useToast } from './hooks/use-toast';
import { useStartupStage } from './hooks/useStartUpStage';
import type { ProcessError } from './hooks/useStartUpStage';

function AppContent() {
  const [showTerms, setShowTerms] = useState(false);
  const [isUpdate, setIsUpdate] = useState(false);
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const { toast } = useToast();

  const { data: termsStatus } = trpcReact.getTermsAccepted.useQuery();
  const { mutateAsync: setTermsAccepted } =
    trpcReact.setTermsAccepted.useMutation({
      onError: (error) => {
        toast({
          variant: 'destructive',
          title: '規約同意の保存に失敗しました',
          description: error.message,
        });
      },
    });
  const { mutateAsync: initializeSentryMain } =
    trpcReact.initializeSentry.useMutation({
      onSuccess: () => {
        // メインプロセスでの初期化が成功した場合のみ、レンダラープロセスでも初期化
        initSentry({
          dsn: 'https://0c062396cbe896482888204f42f947ec@o4504163555213312.ingest.us.sentry.io/4508574659837952',
          environment: process.env.NODE_ENV,
        });
      },
      onError: (error) => {
        toast({
          variant: 'destructive',
          title: 'Sentryの初期化に失敗しました',
          description: error.message,
        });
      },
    });

  useEffect(() => {
    const checkTermsAcceptance = async () => {
      if (!termsStatus) return;

      const { accepted, version } = termsStatus;
      const currentVersion = terms.version;
      console.log('termsStatus', termsStatus);

      if (!accepted) {
        setShowTerms(true);
        setIsUpdate(false);
        setHasAcceptedTerms(false);
      } else if (version !== currentVersion) {
        setShowTerms(true);
        setIsUpdate(true);
        setHasAcceptedTerms(false);
      } else {
        setHasAcceptedTerms(true);
        // 規約同意済みの場合はSentryを初期化
        if (process.env.NODE_ENV === 'production') {
          await initializeSentryMain();
        }
      }
    };

    checkTermsAcceptance();
  }, [termsStatus]);

  const handleTermsAccept = async () => {
    await setTermsAccepted({
      accepted: true,
      version: terms.version,
    });
    setShowTerms(false);
    setHasAcceptedTerms(true);
    // 規約同意時にSentryを初期化
    if (process.env.NODE_ENV === 'production') {
      await initializeSentryMain();
    }
  };

  if (!hasAcceptedTerms) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <TermsModal
          open={showTerms}
          onAccept={handleTermsAccept}
          isUpdate={isUpdate}
          canClose={false}
        />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <AppHeader />
      <ToasterWrapper />
      <Contents />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <TrpcWrapper>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </TrpcWrapper>
    </ErrorBoundary>
  );
}

const ToasterWrapper = () => {
  const { toast } = useToast();
  trpcReact.subscribeToast.useSubscription(undefined, {
    onData: (content: unknown) => {
      if (typeof content === 'string') {
        console.log('toast', content);
        toast({
          description: content,
        });
        return;
      }
      console.log('toast', JSON.stringify(content));
      toast({
        description: JSON.stringify(content),
      });
    },
  });
  return (
    <>
      <Toaster />
    </>
  );
};

const Contents = () => {
  const { toast } = useToast();
  const { stages, retryProcess } = useStartupStage({
    onError: (error: ProcessError) => {
      toast({
        variant: 'destructive',
        title: 'スタートアップエラー',
        description: error.message,
      });
    },
  });

  if (
    stages.startingSync === 'error' ||
    stages.syncDone === 'error' ||
    stages.logsStored === 'error' ||
    stages.indexLoaded === 'error'
  ) {
    const isDataError =
      stages.logsStored === 'error' || stages.indexLoaded === 'error';

    return (
      <div className="flex items-center justify-center h-full">
        {isDataError ? (
          <div className="w-full max-w-2xl mx-auto p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
              初期セットアップ
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              VRChatのログフォルダと写真フォルダを設定して、アプリケーションを使用する準備をしましょう。
            </p>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                      <span className="text-blue-600 dark:text-blue-300">
                        1
                      </span>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      フォルダを設定
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      以下の設定画面からVRChatのログフォルダと写真フォルダを選択してください。
                    </p>
                  </div>
                </div>
                <PathSettings showRefreshAll={false} />
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                      <span className="text-blue-600 dark:text-blue-300">
                        2
                      </span>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      設定を確認
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      フォルダを設定したら、下のボタンをクリックして設定を確認します。
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-6 text-right">
              <button
                type="button"
                onClick={retryProcess}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                設定を確認して続ける
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center p-4 max-w-md mx-auto">
            <h2 className="text-xl font-semibold text-red-600 dark:text-red-400">
              アプリケーションエラー
            </h2>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              予期せぬエラーが発生しました。
              <br />
              <a
                href="https://github.com/your-repo/issues/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                バグを報告する
              </a>
            </p>
            <button
              type="button"
              onClick={retryProcess}
              className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              再試行
            </button>
          </div>
        )}
      </div>
    );
  }

  if (
    stages.startingSync === 'inProgress' ||
    stages.startingSync === 'pending' ||
    stages.syncDone === 'inProgress' ||
    stages.syncDone === 'pending'
  ) {
    const currentStage = (() => {
      if (stages.indexLoaded === 'inProgress')
        return 'インデックスを読み込み中...';
      if (stages.logsStored === 'inProgress') return 'ログを保存中...';
      if (stages.syncDone === 'inProgress') return 'データベースを同期中...';
      if (stages.startingSync === 'inProgress')
        return 'データベースの初期化を開始中...';
      return '初期化中...';
    })();

    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white mx-auto" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">
            {currentStage}
          </p>
        </div>
      </div>
    );
  }

  return <PhotoGallery startUpStages={stages} />;
};

export default App;
