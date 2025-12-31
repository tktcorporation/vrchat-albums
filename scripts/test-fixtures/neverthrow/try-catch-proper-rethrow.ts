// This file should NOT trigger try-catch warning
// because it properly classifies errors and rethrows unexpected ones

import { err, ok, type Result } from 'neverthrow';
import { match } from 'ts-pattern';

interface FileError {
  type: 'FILE_NOT_FOUND' | 'PERMISSION_DENIED';
  message: string;
}

interface NodeError extends Error {
  code?: string;
}

// This should be allowed - proper error classification with rethrow
export async function readFileWithProperClassification(
  _filePath: string,
): Promise<Result<string, FileError>> {
  try {
    // Simulating file read
    const content = 'file content';
    return ok(content);
  } catch (error) {
    const nodeError = error as NodeError;
    // Proper classification using ts-pattern match
    return match(nodeError.code)
      .with('ENOENT', () =>
        err({
          type: 'FILE_NOT_FOUND' as const,
          message: nodeError.message || 'File not found',
        }),
      )
      .with('EACCES', () =>
        err({
          type: 'PERMISSION_DENIED' as const,
          message: nodeError.message || 'Permission denied',
        }),
      )
      .otherwise(() => {
        // Rethrow unexpected errors
        throw error;
      });
  }
}

// This should also be allowed - proper error classification with if statement
export async function readFileWithIfClassification(
  _filePath: string,
): Promise<Result<string, FileError>> {
  try {
    const content = 'file content';
    return ok(content);
  } catch (error: unknown) {
    // Proper classification using if statement
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return err({
        type: 'FILE_NOT_FOUND',
        message: String((error as { message?: string }).message ?? 'Not found'),
      });
    }
    // Rethrow unexpected errors
    throw error;
  }
}
