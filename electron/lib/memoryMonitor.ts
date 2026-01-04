/**
 * メモリ監視ユーティリティ
 *
 * Node.jsのheapUsedだけでなく、RSS（Resident Set Size）を監視することで
 * Sharpなどのネイティブライブラリ（libvips）のメモリ使用量も含めて監視する
 */

import { logger } from './logger';

/**
 * メモリ使用量のスナップショット
 */
export interface MemorySnapshot {
  /** ヒープ使用量 (MB) - V8のJavaScriptオブジェクト */
  heapUsedMB: number;
  /** RSS (MB) - プロセス全体のメモリ（ネイティブメモリ含む） */
  rssMB: number;
  /** 外部メモリ (MB) - ArrayBuffer等 */
  externalMB: number;
  /** タイムスタンプ */
  timestamp: number;
}

/**
 * メモリ監視の設定
 */
export interface MemoryMonitorConfig {
  /** RSS警告閾値 (MB) - この値を超えると警告ログ */
  rssWarningThresholdMB: number;
  /** RSSクリティカル閾値 (MB) - この値を超えると処理を遅延 */
  rssCriticalThresholdMB: number;
  /** メモリ圧迫時の遅延時間 (ms) */
  throttleDelayMs: number;
  /** ログ出力を有効にするか */
  enableLogging: boolean;
}

/**
 * デフォルト設定
 * - 警告: 1GB超過
 * - クリティカル: 1.5GB超過
 */
const DEFAULT_CONFIG: MemoryMonitorConfig = {
  rssWarningThresholdMB: 1024,
  rssCriticalThresholdMB: 1536,
  throttleDelayMs: 100,
  enableLogging: true,
};

/**
 * 現在のメモリ使用量を取得
 */
export const getMemorySnapshot = (): MemorySnapshot => {
  const mem = process.memoryUsage();
  return {
    heapUsedMB: mem.heapUsed / 1024 / 1024,
    rssMB: mem.rss / 1024 / 1024,
    externalMB: mem.external / 1024 / 1024,
    timestamp: Date.now(),
  };
};

/**
 * メモリ監視クラス
 * バッチ処理中のメモリ使用量を監視し、圧迫時に警告・遅延を行う
 */
export class MemoryMonitor {
  private config: MemoryMonitorConfig;
  private peakRssMB = 0;
  private warningCount = 0;
  private lastWarningTime = 0;
  private readonly WARNING_COOLDOWN_MS = 10000; // 10秒間は同じ警告を出さない

  constructor(config: Partial<MemoryMonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 現在のメモリ状態をチェックし、必要に応じて警告・遅延を行う
   * @returns 処理を続行してよい場合はtrue、メモリ圧迫で遅延した場合もtrue（遅延後）
   */
  async checkMemory(context?: string): Promise<MemorySnapshot> {
    const snapshot = getMemorySnapshot();

    // ピークRSSを更新
    if (snapshot.rssMB > this.peakRssMB) {
      this.peakRssMB = snapshot.rssMB;
    }

    const now = Date.now();

    // クリティカル閾値超過時は遅延を入れる
    if (snapshot.rssMB > this.config.rssCriticalThresholdMB) {
      if (
        this.config.enableLogging &&
        now - this.lastWarningTime > this.WARNING_COOLDOWN_MS
      ) {
        logger.warn({
          message: `Memory pressure critical: RSS ${snapshot.rssMB.toFixed(0)}MB > ${this.config.rssCriticalThresholdMB}MB. Throttling processing.`,
          details: {
            context,
            rssMB: snapshot.rssMB,
            heapUsedMB: snapshot.heapUsedMB,
            threshold: this.config.rssCriticalThresholdMB,
          },
        });
        this.lastWarningTime = now;
      }
      this.warningCount++;

      // GCを促すための遅延
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.throttleDelayMs),
      );
    }
    // 警告閾値超過時はログのみ
    else if (snapshot.rssMB > this.config.rssWarningThresholdMB) {
      if (
        this.config.enableLogging &&
        now - this.lastWarningTime > this.WARNING_COOLDOWN_MS
      ) {
        logger.warn({
          message: `Memory usage high: RSS ${snapshot.rssMB.toFixed(0)}MB > ${this.config.rssWarningThresholdMB}MB`,
          details: {
            context,
            rssMB: snapshot.rssMB,
            heapUsedMB: snapshot.heapUsedMB,
            threshold: this.config.rssWarningThresholdMB,
          },
        });
        this.lastWarningTime = now;
      }
      this.warningCount++;
    }

    return snapshot;
  }

  /**
   * ピークRSSを取得
   */
  getPeakRssMB(): number {
    return this.peakRssMB;
  }

  /**
   * 警告回数を取得
   */
  getWarningCount(): number {
    return this.warningCount;
  }

  /**
   * 統計をリセット
   */
  reset(): void {
    this.peakRssMB = 0;
    this.warningCount = 0;
    this.lastWarningTime = 0;
  }

  /**
   * サマリーログを出力
   */
  logSummary(context: string): void {
    if (!this.config.enableLogging) return;

    const snapshot = getMemorySnapshot();
    logger.debug({
      message: `Memory summary for ${context}`,
      details: {
        currentRssMB: snapshot.rssMB.toFixed(2),
        peakRssMB: this.peakRssMB.toFixed(2),
        currentHeapMB: snapshot.heapUsedMB.toFixed(2),
        warningCount: this.warningCount,
      },
    });
  }
}

/**
 * シングルトンインスタンス（グローバルな監視用）
 */
let globalMonitor: MemoryMonitor | null = null;

/**
 * グローバルメモリモニターを取得（遅延初期化）
 */
export const getGlobalMemoryMonitor = (): MemoryMonitor => {
  if (!globalMonitor) {
    globalMonitor = new MemoryMonitor();
  }
  return globalMonitor;
};

/**
 * グローバルメモリモニターをリセット（テスト用）
 */
export const resetGlobalMemoryMonitor = (): void => {
  if (globalMonitor) {
    globalMonitor.reset();
  }
};
