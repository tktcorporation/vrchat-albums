// This file should NOT trigger try-catch warning
// because it uses try-finally for resource cleanup

import * as fs from 'node:fs';
import { err, ok, type Result } from 'neverthrow';

interface FileError {
  type: 'FILE_ERROR';
  message: string;
}

// This should be allowed - try-catch with finally for cleanup
export async function processFileWithCleanup(
  filePath: string,
): Promise<Result<string, FileError>> {
  let tempFile: string | null = null;

  try {
    tempFile = `/tmp/temp-${Date.now()}.txt`;
    fs.writeFileSync(tempFile, 'temp data');

    const content = fs.readFileSync(filePath, 'utf-8');
    return ok(content);
  } catch (error) {
    return err({
      type: 'FILE_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    // Cleanup: remove temp file (ignore errors)
    if (tempFile) {
      fs.unlinkSync(tempFile);
    }
  }
}
