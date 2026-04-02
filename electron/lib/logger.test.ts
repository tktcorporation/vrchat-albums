import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
const mockCaptureException = vi.fn();
const mockCaptureMessage = vi.fn();
const mockGetSettingStore = vi.fn();

// TODO: Electrobun 移行後、Sentry 連携テストを @sentry/node 版に更新
describe.skip('logger Sentry consent integration', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();

    // Set up mocks before importing
    vi.doMock('electron', () => ({
      app: {
        getPath: () => '/test/logs',
        isPackaged: false,
      },
    }));

    vi.doMock('@sentry/electron/main', () => ({
      captureException: mockCaptureException,
      captureMessage: mockCaptureMessage,
    }));

    vi.doMock('../module/settingStore', () => ({
      getSettingStore: mockGetSettingStore,
    }));

    vi.doMock('electron-log', () => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      transports: {
        file: {
          resolvePathFn: vi.fn(),
          maxSize: 0,
          level: 'debug',
          format: '',
          getFile: () => ({ path: '/test/path' }),
        },
        console: {
          level: 'debug',
          format: '',
        },
      },
    }));
  });

  it('should not send to Sentry when terms are not accepted', async () => {
    mockGetSettingStore.mockReturnValue({
      getTermsAccepted: () => false,
    });

    // Dynamically import logger after mocks are set
    const { logger } = await import('./logger');

    logger.error({ message: 'Test error without consent' });

    // Sentryが呼ばれていないことを確認
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('should send to Sentry when terms are accepted', async () => {
    mockGetSettingStore.mockReturnValue({
      getTermsAccepted: () => true,
    });

    // Dynamically import logger after mocks are set
    const { logger } = await import('./logger');

    logger.error({ message: 'Test error with consent' });

    // Sentryが呼ばれていることを確認
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: {
          source: 'electron-main',
        },
      }),
    );
  });

  describe('warnWithSentry', () => {
    it('should not send to Sentry when terms are not accepted', async () => {
      mockGetSettingStore.mockReturnValue({
        getTermsAccepted: () => false,
      });

      const { logger } = await import('./logger');

      logger.warnWithSentry({ message: 'Test warning without consent' });

      expect(mockCaptureMessage).not.toHaveBeenCalled();
    });

    it('should send warning to Sentry via captureMessage when terms are accepted', async () => {
      mockGetSettingStore.mockReturnValue({
        getTermsAccepted: () => true,
      });

      const { logger } = await import('./logger');

      logger.warnWithSentry({ message: 'Test warning with consent' });

      expect(mockCaptureMessage).toHaveBeenCalledWith(
        'Test warning with consent',
        expect.objectContaining({
          level: 'warning',
          tags: {
            source: 'electron-main',
          },
        }),
      );
    });

    it('should include details in Sentry extra when provided', async () => {
      mockGetSettingStore.mockReturnValue({
        getTermsAccepted: () => true,
      });

      const { logger } = await import('./logger');

      logger.warnWithSentry({
        message: 'Test warning with details',
        details: { worldId: 'wrld_123', retryCount: 3 },
      });

      expect(mockCaptureMessage).toHaveBeenCalledWith(
        'Test warning with details',
        expect.objectContaining({
          level: 'warning',
          extra: expect.objectContaining({
            details: { worldId: 'wrld_123', retryCount: 3 },
          }),
        }),
      );
    });

    it('should extract message from Error objects', async () => {
      mockGetSettingStore.mockReturnValue({
        getTermsAccepted: () => true,
      });

      const { logger } = await import('./logger');

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
