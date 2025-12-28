/**
 * Valid: uses logger.warn() with expected error reason (not unexpected_error)
 */
const logger = {
  error: (obj: unknown) => console.error(obj),
  warn: (obj: unknown) => console.warn(obj),
};

export async function validWarnExpected(): Promise<{
  error?: { reason: string };
}> {
  try {
    throw new Error('test');
  } catch (error) {
    logger.warn({
      message: 'File not found',
      stack: error instanceof Error ? error : new Error(String(error)),
    });
    return {
      error: {
        reason: 'file_not_found' as const,
      },
    };
  }
}
