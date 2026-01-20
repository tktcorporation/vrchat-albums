/**
 * 環境判定ユーティリティ
 *
 * テスト環境やプロダクション環境の判定を提供。
 * Electron モジュールの安全なロードフォールバックに使用。
 */

/**
 * テスト環境（Electron API 利用不可）かどうかを判定
 *
 * Playwright E2E テストや Vitest ユニットテストなど、
 * Electron モジュールが利用できない環境を検出する。
 *
 * ## 用途
 * - Electron API の有無による安全なフォールバック
 * - テスト時の Electron モジュール試行回避（クラッシュ防止）
 *
 * ## 注意
 * ビジネスロジックの分岐には使用しないこと。
 * 環境ごとの動作差異は最小限に抑える。
 *
 * @returns テスト環境（Electron 利用不可）の場合 true
 */
export const isTestEnvironment = (): boolean => {
  return (
    process.env.PLAYWRIGHT_TEST === 'true' ||
    process.env.VITEST === 'true' ||
    process.env.NODE_ENV === 'test'
  );
};
