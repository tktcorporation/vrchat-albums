/**
 * Valid: uses logger.error() with unexpected_error reason
 */
const logger = {
  error: (obj: unknown) => console.error(obj),
  warn: (obj: unknown) => console.warn(obj),
};

export async function validErrorLog(): Promise<{ error?: { reason: string } }> {
  try {
    throw new Error('test');
  } catch (error) {
    logger.error({
      message: 'Unexpected error occurred',
      stack: error instanceof Error ? error : new Error(String(error)),
    });
    return {
      error: {
        reason: 'unexpected_error' as const,
      },
    };
  }
}
