import type { Event, EventHint } from '@sentry/electron/main';
import { init as initSentry } from '@sentry/electron/renderer';
import { useEffect, useState } from 'react';
import { match } from 'ts-pattern';
import { Toaster } from '@/components/ui/toaster';
import { scrubEventData } from '@/lib/utils/masking';
import { trpcClient, trpcReact } from '@/trpc';
import { TrpcWrapper } from '@/trpcWrapper';
import './App.css';
import { ERROR_CATEGORIES, parseErrorFromTRPC } from './types/errors';

// Electron レンダラープロセスでの開発環境検出
const isDev = process.env.NODE_ENV === 'development';

import { AppHeader } from './components/AppHeader';
import { ErrorBoundary } from './components/ErrorBoundary';
import PhotoGallery from './components/PhotoGallery';
import PathSettings from './components/settings/PathSettings';
import { TermsModal } from './components/TermsModal';
import { terms } from './constants/terms/ja';
import { StartupProvider, useStartup } from './contexts/StartupContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { useToast } from './hooks/use-toast';
import { useLoadingState } from './hooks/useLoadingState';

interface ErrorEvent extends Event {
  type: undefined;
}

/**
 * 規約の確認や Sentry の初期化など、起動時の処理を行うコンポーネント。
 * これらが完了した後にアプリのメイン画面を表示する。
 */
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
        initSentry({
          dsn: process.env.SENTRY_DSN, // 環境変数からDSNを取得
          environment: isDev ? 'development' : 'production',
          debug: isDev,
          // Sentryプラグインが注入するリリース識別子
          release: __SENTRY_RELEASE__,
          tags: {
            source: 'electron-renderer',
          },
          beforeSend: async (event: ErrorEvent, _hint: EventHint) => {
            try {
              // 開発環境でも規約同意をチェックする
              const currentTermsStatus =
                await trpcClient.getTermsAccepted.query();
              if (currentTermsStatus?.accepted !== true) {
                if (isDev) {
                  console.log(
                    'Sentry event dropped in renderer development mode due to terms not accepted.',
                  );
                } else {
                  console.log(
                    'Sentry event dropped in renderer due to terms not accepted (queried from main).',
                  );
                }
                return null;
              }

              // 個人情報マスク処理を追加
              const processedEvent = scrubEventData(event);

              if (isDev) {
                console.log('Sentry event sent in renderer development mode.');
              }

              return processedEvent;
            } catch (error) {
              console.error(
                'Failed to query terms status from main process for Sentry or scrub event:',
                error,
              );
              return null;
            }
          },
        });
        console.log('Sentry initialized in renderer process');
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
    /**
     * 規約同意状況を確認した上で Sentry を初期化する内部処理。
     * termsStatus が取得できたタイミングで useEffect から呼ばれる。
     */
    const checkTermsAndInitializeSentry = async () => {
      if (!termsStatus) return; // termsStatusが取得できるまで待つ

      // Sentryの初期化（レンダラープロセス側）を試みる
      // 実際の初期化やイベント送信は、DSNの有無やbeforeSendフックで制御される
      // initializeSentryMain の onSuccess フック内でレンダラープロセスのSentryが初期化される
      await initializeSentryMain();

      const { accepted, version } = termsStatus;
      const currentVersion = terms.version;
      console.log('termsStatus', termsStatus);

      match({ accepted, version, currentVersion })
        .when(
          ({ accepted }) => !accepted,
          () => {
            setShowTerms(true);
            setIsUpdate(false);
            setHasAcceptedTerms(false);
          },
        )
        .when(
          ({ version, currentVersion }) => version !== currentVersion,
          () => {
            setShowTerms(true);
            setIsUpdate(true);
            setHasAcceptedTerms(false);
          },
        )
        .otherwise(() => {
          setHasAcceptedTerms(true);
          // setShowTerms(false); // 既に同意済みなのでモーダルは表示しない (この行はあってもなくても良い)
        });
    };

    checkTermsAndInitializeSentry();
  }, [termsStatus, initializeSentryMain]); // initializeSentryMain と termsStatus を依存配列に含める

  /**
   * 規約同意ボタン押下時に呼び出され、
   * 同意状態を保存して Sentry 初期化を完了させる。
   */
  const handleTermsAccept = async () => {
    await setTermsAccepted({
      accepted: true,
      version: terms.version,
    });
    setShowTerms(false);
    setHasAcceptedTerms(true);
    // useEffectでtermsStatusが更新された際に initializeSentryMain が呼ばれるため、ここでの直接呼び出しは不要
    // await initializeSentryMain();
  };

  if (!hasAcceptedTerms) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <AppHeader showGalleryControls={false} />
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
      <ToasterWrapper />
      <Contents />
    </div>
  );
}

/**
 * アプリ全体をエラーバウンダリや各種プロバイダーで包むルートコンポーネント。
 * `main.tsx` から呼び出され、UI をレンダリングするエントリーポイントとなる。
 */
function App() {
  return (
    <ErrorBoundary>
      <TrpcWrapper>
        <ThemeProvider>
          <StartupProvider>
            <AppContent />
          </StartupProvider>
        </ThemeProvider>
      </TrpcWrapper>
    </ErrorBoundary>
  );
}

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
  if (!category) return 'default';

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
                structuredMessage.errorInfo?.userMessage ||
                structuredMessage.message,
              title:
                variant === 'destructive'
                  ? 'エラー'
                  : variant === 'warning'
                    ? '警告'
                    : undefined,
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
        // trpc-electron IPC バグ: query レスポンスが subscription に漏れる問題への対処
        // 根本原因: trpc-electron v0.1.2 の IPC 実装で query/subscription の分離が不完全
        // See: https://github.com/tktcorporation/vrchat-albums/issues/570
        .otherwise((c) => {
          if (import.meta.env.DEV) {
            console.warn(
              '[ToasterWrapper] Ignoring unexpected subscription data (trpc-electron IPC leak):',
              typeof c,
            );
          }
        });
    },
  });
  return <Toaster />;
};

/**
 * 起動処理の進行状況に応じて UI を切り替えるメインコンテンツ部分。
 * 初期同期やエラー状態を監視しながら各画面を表示する。
 */
const Contents = () => {
  // const { toast } = useToast(); // スタートアップエラーはbackendから送信されるため不要
  const { stage, error, originalError, retry } = useStartup();
  const loadingState = useLoadingState();

  // 必要な関数を分割代入で取得し、依存配列を最適化
  const { startLoadingStartupSync, finishLoadingStartupSync } = loadingState;

  useEffect(() => {
    if (stage === 'syncing') {
      startLoadingStartupSync();
    } else {
      finishLoadingStartupSync();
    }
  }, [stage, startLoadingStartupSync, finishLoadingStartupSync]);

  if (stage === 'error') {
    // 型安全なエラー解析 - tRPCエラーオブジェクトがある場合は優先的に使用
    const errorInfo = originalError
      ? parseErrorFromTRPC(originalError)
      : error
        ? parseErrorFromTRPC(error)
        : null;

    // ts-patternを使用した型安全なエラー判定
    const errorDisplayType = match(errorInfo?.category)
      .with(ERROR_CATEGORIES.SETUP_REQUIRED, () => 'setup' as const)
      .with(ERROR_CATEGORIES.PERMISSION_DENIED, () => 'permission' as const)
      .with(ERROR_CATEGORIES.DATABASE_ERROR, () => 'database' as const)
      .with(ERROR_CATEGORIES.NETWORK_ERROR, () => 'network' as const)
      .otherwise(() => 'generic' as const);

    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <AppHeader showGalleryControls={false} />
        <div className="flex items-center justify-center flex-1">
          {match(errorDisplayType)
            .with('setup', () => (
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
                        <div className="w-8 h-8 rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
                          <span className="text-primary">1</span>
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
                        <div className="w-8 h-8 rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
                          <span className="text-primary">2</span>
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
                    onClick={retry}
                    className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                  >
                    設定を確認して続ける
                  </button>
                </div>
              </div>
            ))
            .otherwise(() => (
              <div className="text-center p-4 max-w-md mx-auto">
                <h2 className="text-xl font-semibold text-red-600 dark:text-red-400">
                  {match(errorDisplayType)
                    .with('permission', () => 'アクセス許可エラー')
                    .with('database', () => 'データベースエラー')
                    .with('network', () => 'ネットワークエラー')
                    .otherwise(() => 'アプリケーションエラー')}
                </h2>
                <p className="mt-2 text-gray-600 dark:text-gray-400">
                  {match(errorDisplayType)
                    .with(
                      'permission',
                      () => 'ファイルやフォルダへのアクセス許可が必要です。',
                    )
                    .with(
                      'database',
                      () => 'データベースに接続できませんでした。',
                    )
                    .with(
                      'network',
                      () => 'ネットワーク接続を確認してください。',
                    )
                    .otherwise(() => (
                      <>
                        予期せぬエラーが発生しました。
                        <br />
                        <a
                          href="https://github.com/your-repo/issues/new"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          バグを報告する
                        </a>
                      </>
                    ))}
                </p>
                {errorInfo && (
                  <details className="mt-4 text-left" open>
                    <summary className="cursor-pointer text-sm text-gray-500">
                      エラー詳細
                    </summary>
                    <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-auto">
                      {errorInfo.userMessage}
                    </pre>
                  </details>
                )}
                <button
                  type="button"
                  onClick={retry}
                  className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                >
                  再試行
                </button>
              </div>
            ))}
        </div>
      </div>
    );
  }

  if (stage === 'syncing') {
    const currentStage = '読み込み中...';

    return (
      <div className="h-screen flex flex-col overflow-hidden bg-[#f9f9fa] dark:bg-[#1c1c1e]">
        <AppHeader showGalleryControls={false} />
        <div className="flex items-center justify-center flex-1">
          <div className="text-center p-8 max-w-md">
            {/* ローディングアニメーション */}
            <div className="relative mb-8">
              <div className="mx-auto w-20 h-20 relative">
                {/* ベースの円 */}
                <div className="absolute inset-0 rounded-full bg-gray-100 dark:bg-gray-800" />

                {/* プログレス */}
                <svg
                  className="absolute inset-0 w-full h-full -rotate-90"
                  viewBox="0 0 80 80"
                  aria-label="ローディングインジケーター"
                >
                  <title>ローディングインジケーター</title>
                  <circle
                    cx="40"
                    cy="40"
                    r="36"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    className="text-primary animate-arc-loading"
                    strokeDasharray="226"
                    strokeDashoffset="226"
                    strokeLinecap="round"
                  />
                </svg>

                {/* 中央のアイコン */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-8 h-8 text-gray-600 dark:text-gray-400 animate-fade-in-out">
                    <svg
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      aria-label="写真アイコン"
                    >
                      <title>写真アイコン</title>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* テキストエリア - タイポグラフィ */}
            <div className="space-y-3">
              <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 tracking-tight">
                {currentStage}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                写真とログファイルを準備しています
              </p>
            </div>

            {/* シンプルなドットインジケーター */}
            <div className="mt-8 flex justify-center items-center space-x-1.5">
              <div
                className="w-1.5 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full animate-dot-fade"
                style={{ animationDelay: '0ms' }}
              />
              <div
                className="w-1.5 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full animate-dot-fade"
                style={{ animationDelay: '200ms' }}
              />
              <div
                className="w-1.5 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full animate-dot-fade"
                style={{ animationDelay: '400ms' }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <PhotoGallery {...loadingState} />;
};

export default App;
