import { useEffect, useRef, useState } from 'react';
import { trpcClient } from '@/trpc';
import { BATCH_CONFIG } from '../../../constants/batchConfig';

/**
 * プレイヤー情報の型定義
 */
interface PlayerInfo {
  id: string;
  playerId: string | null;
  playerName: string;
  joinDateTime: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface BatchRequest {
  joinDateTime: Date;
  requestId: string;
  resolve: (players: PlayerInfo[]) => void;
  reject: (error: Error) => void;
}

/**
 * プレイヤー情報バッチマネージャー
 * 設定されたウィンドウ時間で複数のリクエストをまとめて一つのDBクエリで処理
 *
 * @see docs/log-sync-architecture.md - ログ同期設計ドキュメント
 * @see electron/lib/dbQueue.ts
 */
class PlayerInfoBatchManager {
  private pendingRequests: BatchRequest[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private readonly batchDelay = BATCH_CONFIG.BATCH_DELAY_MS;
  private readonly maxBatchSize = BATCH_CONFIG.MAX_SESSION_BATCH_SIZE;
  private readonly duplicateThresholdMs = BATCH_CONFIG.DUPLICATE_THRESHOLD_MS;
  private batchCount = 0; // バッチ実行回数のカウンター

  private executeBatch: (() => Promise<void>) | null = null;
  private isExecuting = false;

  setBatchExecutor(executor: () => Promise<void>) {
    this.executeBatch = executor;
  }

  addRequest(joinDateTime: Date): Promise<PlayerInfo[]> {
    return new Promise((resolve, reject) => {
      const requestId = `${joinDateTime.getTime()}-${Math.random()}`;

      // 既存の同じ日時のリクエストがあるかチェック
      const existingRequest = this.pendingRequests.find(
        (req) =>
          Math.abs(req.joinDateTime.getTime() - joinDateTime.getTime()) <
          this.duplicateThresholdMs,
      );

      if (existingRequest) {
        // 既存のリクエストに相乗りする
        console.debug(
          `[PlayerInfoBatch] Duplicate request merged: ${joinDateTime.toISOString()}, total pending: ${
            this.pendingRequests.length
          }`,
        );
        const originalResolve = existingRequest.resolve;
        existingRequest.resolve = (players) => {
          originalResolve(players);
          resolve(players);
        };
        return;
      }

      this.pendingRequests.push({ joinDateTime, requestId, resolve, reject });
      console.debug(
        `[PlayerInfoBatch] Request added: ${joinDateTime.toISOString()}, total pending: ${
          this.pendingRequests.length
        }`,
      );

      // バッチサイズが上限に達したか、または実行中でない場合の処理
      if (this.pendingRequests.length >= this.maxBatchSize) {
        console.debug(
          `[PlayerInfoBatch] Max batch size reached (${this.maxBatchSize}), flushing immediately`,
        );
        this.flushBatch();
        return;
      }

      // タイムアウトベースのバッチ実行
      if (!this.batchTimeout && !this.isExecuting) {
        console.debug(
          `[PlayerInfoBatch] Scheduling batch execution in ${this.batchDelay}ms, pending: ${this.pendingRequests.length}`,
        );
        this.batchTimeout = setTimeout(() => {
          this.flushBatch();
        }, this.batchDelay);
      }
    });
  }

  private flushBatch() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    if (this.pendingRequests.length === 0 || this.isExecuting) {
      if (this.pendingRequests.length === 0) {
        console.debug('[PlayerInfoBatch] No pending requests to flush');
      } else {
        console.debug(
          '[PlayerInfoBatch] Batch already executing, skipping flush',
        );
      }
      return;
    }

    this.batchCount++;
    const currentBatchCount = this.batchCount;
    const requestCount = this.pendingRequests.length;

    // バッチサイズ制限を確実に守る
    if (requestCount > this.maxBatchSize) {
      console.warn(
        `[PlayerInfoBatch] Batch size (${requestCount}) exceeds limit (${this.maxBatchSize}). Splitting batch.`,
      );

      // 最大サイズずつに分割して処理
      const firstBatch = this.pendingRequests.slice(0, this.maxBatchSize);
      const remainingRequests = this.pendingRequests.slice(this.maxBatchSize);

      // 現在のリクエストを最大サイズに制限
      this.pendingRequests = firstBatch;

      console.debug(
        `[PlayerInfoBatch] Executing split batch #${currentBatchCount} with ${firstBatch.length} requests (${remainingRequests.length} remaining)`,
      );

      this.isExecuting = true;
      const startTime = performance.now();

      if (this.executeBatch) {
        this.executeBatch().finally(() => {
          const executionTime = performance.now() - startTime;
          console.debug(
            `[PlayerInfoBatch] Split batch #${currentBatchCount} completed in ${executionTime.toFixed(
              2,
            )}ms`,
          );

          this.isExecuting = false;
          // 残りのリクエストを次の処理用に設定
          this.pendingRequests = remainingRequests;

          // 残りのリクエストがある場合は次のバッチをスケジュール
          if (this.pendingRequests.length > 0) {
            console.debug(
              `[PlayerInfoBatch] ${this.pendingRequests.length} requests remaining, scheduling next batch`,
            );
            this.batchTimeout = setTimeout(() => {
              this.flushBatch();
            }, this.batchDelay);
          }
        });
      }
      return;
    }

    console.debug(
      `[PlayerInfoBatch] Executing batch #${currentBatchCount} with ${requestCount} requests`,
    );

    this.isExecuting = true;
    const startTime = performance.now();

    if (this.executeBatch) {
      this.executeBatch().finally(() => {
        const executionTime = performance.now() - startTime;
        console.debug(
          `[PlayerInfoBatch] Batch #${currentBatchCount} completed in ${executionTime.toFixed(
            2,
          )}ms`,
        );

        this.isExecuting = false;
        // 実行後に新しいリクエストがある場合は次のバッチをスケジュール
        if (this.pendingRequests.length > 0) {
          console.debug(
            `[PlayerInfoBatch] ${this.pendingRequests.length} new requests arrived, scheduling next batch`,
          );
          this.batchTimeout = setTimeout(() => {
            this.flushBatch();
          }, this.batchDelay);
        }
      });
    }
  }

  getPendingRequests() {
    return this.pendingRequests;
  }

  clearPendingRequests() {
    this.pendingRequests = [];
  }
}

// グローバルなバッチマネージャー
const globalPlayerBatchManager = new PlayerInfoBatchManager();

/**
 * プレイヤー情報を効率的にバッチ取得するフック
 * 設定されたウィンドウ時間で複数のリクエストをまとめて一つのDBクエリで処理
 */
export const useSessionInfoBatch = (joinDateTime: Date, enabled = true) => {
  const [players, setPlayers] = useState<PlayerInfo[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const requestIdRef = useRef<string | null>(null);

  // バッチ実行関数を設定
  useEffect(() => {
    globalPlayerBatchManager.setBatchExecutor(async () => {
      const pendingRequests = globalPlayerBatchManager.getPendingRequests();
      if (pendingRequests.length === 0) return;

      const joinDateTimes = pendingRequests.map((req) => req.joinDateTime);

      try {
        const startTime = performance.now();
        console.debug(
          `[PlayerInfoBatch] API call started for ${joinDateTimes.length} sessions`,
        );

        // バッチサイズをログ出力してチェック
        console.warn(
          `[PlayerInfoBatch] About to send ${joinDateTimes.length} items to API (max allowed: ${BATCH_CONFIG.MAX_SESSION_BATCH_SIZE})`,
        );

        if (joinDateTimes.length > BATCH_CONFIG.MAX_SESSION_BATCH_SIZE) {
          console.error(
            `[PlayerInfoBatch] CRITICAL: Batch size exceeds limit! Sending ${joinDateTimes.length} items`,
          );
        }

        // セッション情報のバッチAPIを呼び出し（プレイヤー情報のみ使用）
        const result =
          await trpcClient.logInfo.getSessionInfoBatch.query(joinDateTimes);

        const apiTime = performance.now() - startTime;
        console.debug(
          `[PlayerInfoBatch] API call completed in ${apiTime.toFixed(2)}ms`,
        );

        // 各リクエストの結果を解決（プレイヤー情報のみ抽出）
        let totalPlayers = 0;
        for (const request of pendingRequests) {
          const dateKey = request.joinDateTime.toISOString();
          const sessionInfo = result[dateKey];
          const playerList = sessionInfo?.players || [];
          totalPlayers += playerList.length;
          request.resolve(playerList);
        }

        console.debug(
          `[PlayerInfoBatch] Resolved ${pendingRequests.length} requests with ${totalPlayers} total players`,
        );

        globalPlayerBatchManager.clearPendingRequests();
      } catch (error) {
        console.error(
          `[PlayerInfoBatch] Batch execution failed for ${pendingRequests.length} requests:`,
          error,
        );

        // すべてのリクエストをエラーで解決
        for (const request of pendingRequests) {
          request.reject(
            error instanceof Error ? error : new Error('Batch query failed'),
          );
        }

        globalPlayerBatchManager.clearPendingRequests();
      }
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      setPlayers(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const requestId = `${joinDateTime.getTime()}-${Math.random()}`;
    requestIdRef.current = requestId;

    setIsLoading(true);
    setError(null);

    globalPlayerBatchManager
      .addRequest(joinDateTime)
      .then((result) => {
        // リクエストIDが一致する場合のみ結果を設定（古いリクエストを無視）
        if (requestIdRef.current === requestId) {
          setPlayers(result);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (requestIdRef.current === requestId) {
          setError(err);
          setIsLoading(false);
        }
      });

    return () => {
      // コンポーネントがアンマウントされた場合、リクエストIDをクリア
      if (requestIdRef.current === requestId) {
        requestIdRef.current = null;
      }
    };
  }, [joinDateTime, enabled]);

  return { players, isLoading, error };
};
