import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * @sentry/node を使ったロガーの Sentry 連携テスト。
 *
 * 背景: @sentry/electron/main から @sentry/node に移行。
 * logger.error / logger.warnWithSentry が @sentry/node の
 * captureException / captureMessage を呼ぶことを検証する。
 *
 * 注意: vitest.setup.ts で @sentry/node はグローバルにモック済み。
 * logger.ts は静的 import で @sentry/node を使用するため、
 * vi.mock のホイスティングでモックが正しく適用される。
 */
import { logger } from './logger';

describe('logger Sentry integration (@sentry/node)', () => {
  let mockCaptureException: ReturnType<typeof vi.fn>;
  let mockCaptureMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const Sentry = await import('@sentry/node');
    mockCaptureException = vi.mocked(Sentry.captureException);
    mockCaptureMessage = vi.mocked(Sentry.captureMessage);
  });

  it('should send error to Sentry via captureException', () => {
    const testError = new Error('Test error');
    logger.error({ message: testError });

    expect(mockCaptureException).toHaveBeenCalledWith(
      testError,
      expect.objectContaining({
        extra: undefined,
      }),
    );
  });

  it('should send string message error to Sentry', () => {
    logger.error({ message: 'String error message' });

    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.anything(),
    );
  });

  it('should send error with details as extra', () => {
    logger.error({
      message: 'Error with details',
      details: { worldId: 'wrld_123' },
    });

    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: { worldId: 'wrld_123' },
      }),
    );
  });

  it('should prefer stack over normalized error for captureException', () => {
    const stackError = new Error('Original stack');
    logger.error({ message: 'Wrapper message', stack: stackError });

    expect(mockCaptureException).toHaveBeenCalledWith(
      stackError,
      expect.anything(),
    );
  });

  describe('warnWithSentry', () => {
    it('should send warning to Sentry via captureMessage', () => {
      logger.warnWithSentry({ message: 'Test warning' });

      expect(mockCaptureMessage).toHaveBeenCalledWith('Test warning', {
        level: 'warning',
        extra: undefined,
      });
    });

    it('should include details in Sentry extra when provided', () => {
      logger.warnWithSentry({
        message: 'Warning with details',
        details: { worldId: 'wrld_123', retryCount: 3 },
      });

      expect(mockCaptureMessage).toHaveBeenCalledWith(
        'Warning with details',
        expect.objectContaining({
          level: 'warning',
          extra: { worldId: 'wrld_123', retryCount: 3 },
        }),
      );
    });

    it('should extract message from Error objects', () => {
      logger.warnWithSentry({
        message: new Error('Error object warning'),
      });

      expect(mockCaptureMessage).toHaveBeenCalledWith(
        'Error object warning',
        expect.objectContaining({
          level: 'warning',
        }),
      );
    });
  });
});
