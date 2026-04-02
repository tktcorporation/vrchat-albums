/**
 * Electrobun RPC の型定義。
 *
 * 背景: Electron の tRPC-over-IPC を Electrobun の型安全 RPC に置き換える。
 * tRPC ルーターは既存のビジネスロジックとして維持し、
 * Electrobun RPC 経由でルーター呼び出しをブリッジする。
 *
 * 呼び出し元: src/bun/index.ts (メインプロセス), src/main-ui/index.ts (ブラウザ側)
 */
import type { RPCSchema } from 'electrobun/bun';

/**
 * tRPC プロシージャ呼び出しを JSON シリアライズ可能な形式で表現する型。
 * Electrobun RPC の request/response でやり取りする。
 */
export interface TRPCCallParams {
  /** tRPC プロシージャのドット区切りパス (e.g. "logSync.syncLogs") */
  path: string;
  /** "query" | "mutation" | "subscription" */
  type: 'query' | 'mutation' | 'subscription';
  /** JSON シリアライズ済みの入力 */
  input: string | null;
}

export interface TRPCCallResponse {
  /** JSON シリアライズ済みの結果 */
  result: string | null;
  /** エラーがあれば JSON シリアライズ済みのエラー情報 */
  error: string | null;
}

/**
 * ウィンドウ操作（最小化・最大化・閉じる）のアクション型
 */
export type WindowAction = 'minimize' | 'maximize' | 'close';

/**
 * Electrobun RPC スキーマ定義。
 *
 * bun 側: tRPC ルーターへのブリッジ、ウィンドウ操作
 * webview 側: サブスクリプション通知の受信
 */
export interface AppRPCSchema {
  bun: RPCSchema<{
    requests: {
      /**
       * tRPC プロシージャを呼び出すための汎用 RPC エンドポイント。
       * 既存の tRPC ルーター全体を 1 つの RPC request でブリッジする。
       */
      trpcCall: {
        params: TRPCCallParams;
        response: TRPCCallResponse;
      };
    };
    messages: {
      /** ウィンドウ操作（最小化・最大化・閉じる） */
      windowAction: { action: WindowAction };
      /** エラーメッセージ通知 */
      errorMessage: { message: string };
    };
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      /** トースト通知をレンダラに送信 */
      toast: { data: string };
      /** 初期化進捗をレンダラに送信 */
      initProgress: { data: string };
    };
  }>;
}
