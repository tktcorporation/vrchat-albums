import { memo, type ReactNode } from 'react';
import { match } from 'ts-pattern';

import { Toaster } from '@/components/ui/toaster';
import { trpcReact } from '@/trpc';
import { TrpcWrapper } from '@/trpcWrapper';

import { AppHeader } from './components/AppHeader';
import { ErrorBoundary } from './components/ErrorBoundary';
import PhotoGallery from './components/PhotoGallery';
import PathSettings from './components/settings/PathSettings';
import { StartupTimelineScreen } from './components/startup/StartupTimelineScreen';
import { TermsModal } from './components/TermsModal';
import { ThemeProvider } from './contexts/ThemeContext';
import { useEntryFlow } from './entryFlow/useEntryFlow';
import { useToast } from './hooks/use-toast';
import { useInitProgress } from './hooks/useInitProgress';
import { useLoadingState } from './hooks/useLoadingState';
import { useI18n } from './i18n/store';
import {
  ERROR_CATEGORIES,
  type ParsedErrorInfo,
  parseErrorFromTRPC,
} from './types/errors';

/**
 * アプリ全体をエラーバウンダリや各種プロバイダーで包むルートコンポーネント。
 * `main.tsx` から呼び出され、UI をレンダリングするエントリーポイントとなる。
 *
 * 通知（Toaster）は起動の流れのどの段階でも出せるよう、画面の出し分けより外に置く。
 */
function App() {
  return (
    <ErrorBoundary>
      <TrpcWrapper>
        <ThemeProvider>
          <div className="h-screen flex flex-col overflow-hidden">
            <ToasterWrapper />
            <AppEntry />
          </div>
        </ThemeProvider>
      </TrpcWrapper>
    </ErrorBoundary>
  );
}

/**
 * 起動の流れの段階（`useEntryFlow`）に応じて画面を出し分ける。どの画面を出すかはここだけで決まる。
 */
const AppEntry = () => {
  const { state, acceptTerms, retry } = useEntryFlow();
  return (
    match(state)
      .with({ phase: 'checkingTerms' }, () => <HeaderOnlyScreen />)
      .with({ phase: 'termsUnavailable' }, ({ error }) => (
        <TermsUnavailableScreen error={error} onRetry={retry} />
      ))
      .with({ phase: 'termsRequired' }, ({ reason }) => (
        <HeaderOnlyScreen>
          <TermsModal
            open
            onAccept={acceptTerms}
            isUpdate={reason === 'update'}
            canClose={false}
          />
        </HeaderOnlyScreen>
      ))
      // 再試行のたびに作り直し、前の試行の進捗を引き継がない
      .with({ phase: 'initializing' }, ({ attempt }) => (
        <StartupLoadingScreen key={attempt} />
      ))
      .with({ phase: 'setupRequired' }, () => (
        <SetupScreen onContinue={retry} />
      ))
      .with({ phase: 'initFailed' }, ({ error }) => (
        <InitFailedScreen error={error} onRetry={retry} />
      ))
      .with({ phase: 'ready' }, () => <GalleryScreen />)
      .exhaustive()
  );
};

/** ヘッダー（ウィンドウ操作を含む）だけの画面。規約の確認中と同意画面の背景に使う */
const HeaderOnlyScreen = ({ children }: { children?: ReactNode }) => (
  <div className="h-screen flex flex-col overflow-hidden">
    <AppHeader showGalleryControls={false} />
    {children}
  </div>
);

/** 保存された同意状況を読めなかったときの画面。読めるまでは先へ進めない */
const TermsUnavailableScreen = ({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) => {
  const { t } = useI18n();
  return (
    <HeaderOnlyScreen>
      <div className="flex items-center justify-center flex-1">
        <div className="text-center p-4 max-w-md mx-auto">
          <h2 className="text-xl font-semibold text-destructive">
            {t('terms.loadFailed')}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {parseErrorFromTRPC(error).userMessage}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
          >
            {t('terms.retry')}
          </button>
        </div>
      </div>
    </HeaderOnlyScreen>
  );
};

/** 起動時の初期化の進み具合を出す画面。起動時の実行の進捗だけを見る */
const StartupLoadingScreen = () => {
  const { progress, overallProgress, details, syncMode, isFirstLaunch, stats } =
    useInitProgress({ runKind: 'startup' });
  return (
    <StartupTimelineScreen
      runStage={progress?.stage ?? null}
      overallProgress={overallProgress}
      details={details}
      syncMode={syncMode}
      isFirstLaunch={isFirstLaunch}
      stats={stats}
    />
  );
};

const GalleryScreen = () => {
  const loadingState = useLoadingState();
  return <PhotoGallery {...loadingState} />;
};

/**
 * 構造化エラー情報を持つトーストメッセージの型定義
 */
interface StructuredToastMessage {
  message: string;
  errorInfo?: {
    code: string;
    category: string;
    userMessage: string;
  };
}

/**
 * エラーカテゴリーに基づいてトーストのvariantを決定
 */
function getToastVariant(
  category?: string,
): 'default' | 'destructive' | 'warning' {
  if (!category) {
    return 'default';
  }

  return match(category)
    .with(ERROR_CATEGORIES.FILE_NOT_FOUND, () => 'warning' as const)
    .with(ERROR_CATEGORIES.VALIDATION_ERROR, () => 'warning' as const)
    .with(ERROR_CATEGORIES.SETUP_REQUIRED, () => 'default' as const)
    .with(ERROR_CATEGORIES.PERMISSION_DENIED, () => 'destructive' as const)
    .with(ERROR_CATEGORIES.DATABASE_ERROR, () => 'destructive' as const)
    .with(ERROR_CATEGORIES.NETWORK_ERROR, () => 'destructive' as const)
    .otherwise(() => 'destructive' as const);
}

/**
 * トーストイベントを購読して `Toaster` コンポーネントを表示するラッパー。
 * 構造化エラー情報に基づいて適切なトーストvariantを選択する。
 */
const ToasterWrapper = () => {
  const { toast } = useToast();
  trpcReact.subscribeToast.useSubscription(undefined, {
    onData: (content: unknown) => {
      match(content)
        // 構造化トーストメッセージの処理
        .when(
          (c): c is StructuredToastMessage =>
            typeof c === 'object' && c !== null && 'message' in c,
          (structuredMessage) => {
            const variant = getToastVariant(
              structuredMessage.errorInfo?.category,
            );

            toast({
              variant,
              description:
                structuredMessage.errorInfo?.userMessage ??
                structuredMessage.message,
              title: (() => {
                if (variant === 'destructive') {
                  return 'エラー';
                }
                if (variant === 'warning') {
                  return '警告';
                }
              })(),
            });
          },
        )
        // 従来の文字列メッセージの処理
        .when(
          (c): c is string => typeof c === 'string',
          (message) => {
            // 「予期しないエラー」以外は通常のトーストとして表示
            const isUnexpectedError = message.includes(
              '予期しないエラーが発生しました',
            );

            toast({
              variant: isUnexpectedError ? 'destructive' : 'default',
              description: message,
              title: isUnexpectedError ? 'エラー' : undefined,
            });
          },
        )
        // その他の場合: 予期しないデータは無視
        // 想定外の形のデータは表示せずに捨てる。別のリクエストの応答が届く問題は、
        // tRPC クライアントを 1 つにして防いでいる（src/trpc.ts）
        .otherwise((c) => {
          if (import.meta.env.DEV) {
            console.warn(
              '[ToasterWrapper] Ignoring unexpected subscription data:',
              typeof c,
            );
          }
        });
    },
  });
  return <Toaster />;
};

/** 写真やログのフォルダが見つからず初期化できなかったときの画面。設定し直して初期化をやり直す */
const SetupScreen = ({ onContinue }: { onContinue: () => void }) => (
  <HeaderOnlyScreen>
    <div className="flex items-center justify-center flex-1">
      <div className="w-full max-w-2xl mx-auto p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">
          初期セットアップ
        </h2>
        <PathSettings showRefreshAll={false} />
        <div className="mt-6 text-right">
          <button
            type="button"
            onClick={onContinue}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            設定を確認して続ける
          </button>
        </div>
      </div>
    </div>
  </HeaderOnlyScreen>
);

/** 初期設定では解決しない理由で初期化に失敗したときの画面 */
const InitFailedScreen = memo(
  ({ error, onRetry }: { error: ParsedErrorInfo; onRetry: () => void }) => {
    const { t } = useI18n();
    const kind = match(error.category)
      .with(ERROR_CATEGORIES.PERMISSION_DENIED, () => 'permission' as const)
      .with(ERROR_CATEGORIES.DATABASE_ERROR, () => 'database' as const)
      .with(ERROR_CATEGORIES.NETWORK_ERROR, () => 'network' as const)
      .otherwise(() => 'generic' as const);

    return (
      <HeaderOnlyScreen>
        <div className="flex items-center justify-center flex-1">
          <div className="text-center p-4 max-w-md mx-auto">
            <h2 className="text-xl font-semibold text-red-600 dark:text-red-400">
              {match(kind)
                .with('permission', () => 'アクセス許可エラー')
                .with('database', () => 'データベースエラー')
                .with('network', () => 'ネットワークエラー')
                .with('generic', () => 'アプリケーションエラー')
                .exhaustive()}
            </h2>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              {match(kind)
                .with(
                  'permission',
                  () => 'ファイルやフォルダへのアクセス許可が必要です。',
                )
                .with('database', () => 'データベースに接続できませんでした。')
                .with('network', () => 'ネットワーク接続を確認してください。')
                .with('generic', () => (
                  <>
                    予期せぬエラーが発生しました。
                    <br />
                    <a
                      href="https://github.com/tktcorporation/vrchat-albums/issues/new"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline text-foreground hover:text-primary"
                    >
                      {t('common.reportBug')}
                    </a>
                  </>
                ))
                .exhaustive()}
            </p>
            <details className="mt-4 text-left" open>
              <summary className="cursor-pointer text-sm text-gray-500">
                エラー詳細
              </summary>
              <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-auto">
                {error.userMessage}
              </pre>
            </details>
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
            >
              再試行
            </button>
          </div>
        </div>
      </HeaderOnlyScreen>
    );
  },
);

InitFailedScreen.displayName = 'InitFailedScreen';

export default App;
