import { useCallback, useEffect, useReducer, useRef } from 'react';

import { invalidatePhotoGalleryQueries } from '@/queryClient';
import { trpcClient, trpcReact } from '@/trpc';

import { terms } from '../constants/terms/ja';
import { useToast } from '../hooks/use-toast';
import { useI18n } from '../i18n/store';
import { initRendererSentry } from '../lib/rendererSentry';
import { type ParsedErrorInfo, parseErrorFromTRPC } from '../types/errors';
import {
  decideTerms,
  hasConsented,
  initialEntryState,
  reduceEntryFlow,
} from './entryFlow';

/**
 * 起動画面の最小表示時間（ミリ秒）。初期化がすぐ終わっても、起動画面が一瞬だけ映って消えるのを避ける。
 */
const MIN_LOADING_DISPLAY_MS = 800;

type InitResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ParsedErrorInfo };

const waitUntil = (deadline: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, deadline - Date.now()));
  });

/**
 * メインプロセスに初期化（DB の準備・ログと写真の読み込み）を依頼する。
 * 成功したら、起動画面を最小表示時間まで出したうえで、ギャラリーが読むクエリのキャッシュを捨てる。
 */
const initialize = async (
  utils: ReturnType<typeof trpcReact.useUtils>,
): Promise<InitResult> => {
  const deadline = Date.now() + MIN_LOADING_DISPLAY_MS;
  return trpcClient.settings.initializeAppData.mutate().then(
    async (): Promise<InitResult> => {
      await waitUntil(deadline);
      // キャッシュを捨てられなくてもギャラリーは開ける。古い表示は次の再取得で直る
      await invalidatePhotoGalleryQueries(utils).catch((error: unknown) => {
        console.warn('Failed to invalidate query cache:', error);
      });
      return { ok: true };
    },
    (error: unknown): InitResult => ({
      ok: false,
      error: parseErrorFromTRPC(error),
    }),
  );
};

/**
 * 起動の流れを進めるフック。段階ごとの副作用はすべてここにあり、段階に入ったときにだけ始まる。
 *
 * - 規約の確認中：保存された同意状況を読む
 * - 初期化中：メインプロセスに初期化を依頼する（再試行のたびに `attempt` が変わって依頼し直す）
 * - 同意後：エラー監視を始め、アップデートを一度確認する
 *
 * effect の後始末で結果を捨てるので、段階を離れた後に届いた結果で状態が進むことはない。
 */
export const useEntryFlow = () => {
  const [state, dispatch] = useReducer(reduceEntryFlow, initialEntryState);
  // 初期化の effect を utils の参照の変化で始め直さないよう、ref 越しに渡す
  const utilsRef = useRef(trpcReact.useUtils());
  const { toast } = useToast();
  const { t } = useI18n();

  const isCheckingTerms = state.phase === 'checkingTerms';
  useEffect(() => {
    if (!isCheckingTerms) {
      return;
    }
    let active = true;
    void trpcClient.getTermsAccepted.query().then(
      (saved) => {
        if (active) {
          dispatch({
            type: 'termsChecked',
            decision: decideTerms(saved, terms.version),
          });
        }
      },
      (error: unknown) => {
        if (active) {
          dispatch({ type: 'termsCheckFailed', error });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [isCheckingTerms]);

  const initAttempt = state.phase === 'initializing' ? state.attempt : null;
  useEffect(() => {
    if (initAttempt === null) {
      return;
    }
    let active = true;
    void initialize(utilsRef.current).then((result) => {
      if (!active) {
        return;
      }
      dispatch(
        result.ok
          ? { type: 'initSucceeded', attempt: initAttempt }
          : { type: 'initFailed', attempt: initAttempt, error: result.error },
      );
    });
    return () => {
      active = false;
    };
  }, [initAttempt]);

  const consented = hasConsented(state);
  useEffect(() => {
    if (!consented) {
      return;
    }
    initRendererSentry();
    // 確認に失敗しても使い続けられる。次回起動時に確認し直す
    void trpcClient.updater.checkForUpdates.mutate().catch((error: unknown) => {
      console.warn('Failed to check for updates:', error);
    });
  }, [consented]);

  const acceptTerms = useCallback(() => {
    void trpcClient.setTermsAccepted
      .mutate({ accepted: true, version: terms.version })
      .then(
        () => dispatch({ type: 'termsAccepted' }),
        (error: unknown) => {
          toast({
            variant: 'destructive',
            title: t('terms.saveFailed'),
            description: parseErrorFromTRPC(error).userMessage,
          });
        },
      );
  }, [toast, t]);

  const retry = useCallback(() => dispatch({ type: 'retry' }), []);

  return { state, acceptTerms, retry };
};
