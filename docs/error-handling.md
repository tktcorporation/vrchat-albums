# Error Handling Documentation

This document outlines the error handling strategy for the application, focusing on how errors are processed and reported, especially in the context of tRPC and Electron.

## Core Principles

1.  **User Experience**: For errors that users need to be aware of, display clear, understandable messages. For unexpected system errors, provide a generic "unexpected error" message to avoid confusing users with technical details.
2.  **Developer Insight**: For developers, ensure all errors are logged with sufficient detail (including stack traces and context) to Sentry for effective debugging.
3.  **Distinction**: Clearly distinguish between errors meant for user display (handled errors) and system-level or unexpected errors.

## Error Types

We use a custom error class, `UserFacingError`, to distinguish errors that should display a specific message to the user from other types of errors.

- **`UserFacingError`** (`electron/lib/errors.ts`):
  - Base class for errors where a specific message should be shown to the user.
  - When an error inheriting from `UserFacingError` is thrown from a tRPC procedure, its `message` property will be displayed directly to the user via a toast notification.
  - Example: `throw new UserFacingError('Could not load the specified file. Please check the file path and try again.');`
- **`OperationFailedError`** (`electron/lib/errors.ts`):
  - A subclass of `UserFacingError` for more specific operational failures.
  - Example: `throw new OperationFailedError('User login', 'Invalid credentials');`
- **Standard `Error` or other error types**:
  - Any error not inheriting from `UserFacingError` is considered an unexpected or system-level error.
  - When such an error occurs in a tRPC procedure, the user will see a generic toast notification: "予期しないエラーが発生しました。" (An unexpected error occurred).
  - The original error details are still sent to Sentry.

## Coexistence with neverthrow

Our application uses **neverthrow's Result pattern** in service layers and **UserFacingError pattern** in tRPC procedure layers. This hybrid approach provides the best of both worlds:

### Service Layer (neverthrow Result pattern)

- **File operations**, **database operations**, **external API calls** continue to use neverthrow's `Result<T, E>` pattern
- This allows detailed error information to flow up to the caller
- Callers can make informed decisions about how to handle specific error types

### tRPC Procedure Layer (UserFacingError pattern)

- **tRPC procedures** convert neverthrow Results into appropriate UserFacingErrors or let unexpected errors propagate
- This ensures users see appropriate messages while developers get full error details in Sentry

### Helper Functions for Result-to-UserFacingError Conversion

We provide helper functions in `electron/lib/errorHelpers.ts` to bridge neverthrow Results and UserFacingErrors:

#### `handleResultError<T, E>(result: Result<T, E>, errorMappings: {...}): T`

Converts a Result's error to a UserFacingError based on the provided mapping:

```typescript
import { handleResultError, fileOperationErrorMappings } from '../lib/errorHelpers';

// In a tRPC procedure
openPathOnExplorer: procedure.input(z.string()).mutation(async (ctx) => {
  const result = await service.openPathOnExplorer(ctx.input);
  // This will throw UserFacingError('指定されたファイルまたはフォルダが見つかりません。') for ENOENT
  handleResultError(result, fileOperationErrorMappings);
  return true;
}),
```

#### `handleResultErrorWithSilent<T, E>(result: Result<T, E>, silentErrors: string[], errorMappings?: {...}): T | null`

Handles Results where some errors should be processed silently (e.g., user cancellation):

```typescript
import { handleResultErrorWithSilent, fileOperationErrorMappings } from '../lib/errorHelpers';

// In a tRPC procedure
setVRChatLogFilesDirByDialog: procedure.mutation(async () => {
  const result = await service.setVRChatLogFilesDirByDialog();
  // 'canceled' errors return null silently, other errors become UserFacingErrors
  const dialogResult = handleResultErrorWithSilent(result, ['canceled'], fileOperationErrorMappings);
  if (dialogResult !== null) {
    eventEmitter.emit('toast', 'VRChatのログファイルの保存先を設定しました');
  }
  return true;
}),
```

### Predefined Error Mappings

We provide several predefined error mappings for common scenarios:

- **`fileOperationErrorMappings`**: For file system operations (ENOENT, canceled, etc.)
- **`vrchatLogErrorMappings`**: For VRChat log file operations
- **`photoOperationErrorMappings`**: For photo file operations
- **`databaseErrorMappings`**: For database operations

## tRPC Error Handling Flow (Electron Main Process)

The primary error handling is managed by a tRPC middleware and an error formatter defined in `electron/trpc.ts`.

1.  **`errorHandler` Middleware**:
    - Wraps every tRPC procedure execution.
    - Catches any error thrown within a procedure.
    - Calls the `logError` function to log the error and potentially send it to Sentry.
    - Re-throws the error as a `TRPCError`, ensuring the `cause` property contains the original error. This is crucial for the `errorFormatter`.

2.  **`errorFormatter`**:
    - This tRPC function shapes the error object before it's sent to the client (renderer process).
    - It checks if `error.cause` is an instance of `UserFacingError`.
      - If **yes**, the `message` property of the `UserFacingError` is used as the error message sent to the client. This message is then displayed in a toast by the frontend.
      - If **no** (i.e., it's a standard `Error` or another type), a generic message ("予期しないエラーが発生しました。") is set as the error message sent to the client.
    - This ensures that the client-side `toast` always shows a user-appropriate message.

3.  **`logError` Function** (`electron/trpc.ts`):
    - Receives the error from the `errorHandler` middleware.
    - Calls `log.error` (from `electron/lib/logger.ts`) to log the error locally and send it to Sentry.
      - It always sends the full details of the original error to `log.error`, regardless of whether it was a `UserFacingError` or not.
    - Emits a `toast` event via `eventEmitter`.
      - If the error is a `UserFacingError` or a Sentry Test Error, its specific message is used for the toast.
      - Otherwise, the generic "予期しないエラーが発生しました。" message is used.

## `logger.ts` (`electron/lib/logger.ts`)

- The `error` function in `logger.ts` is responsible for the actual logging and Sentry reporting.
- It logs the error to the local file system (`electron-log`).
- It sends the error to Sentry via `captureException` if:
  - The application is in `production` mode.
  - OR the error is identified as a "Sentry Test Error" (contains 'test error for Sentry' in its message or has the name `SentryTestError`). This allows testing Sentry integration in development.
- Additional metadata (like `isSentryTestError` tag) is added to Sentry reports for better context.

## How to Handle Errors in Your Code (tRPC Procedures)

### For neverthrow Results in tRPC procedures:

- **Use helper functions** to convert Results to appropriate UserFacingErrors:

  ```typescript
  import {
    handleResultError,
    fileOperationErrorMappings,
  } from '../lib/errorHelpers';

  // Example 1: Simple error mapping
  procedure.mutation(async (ctx) => {
    const result = await someServiceCall(ctx.input);
    handleResultError(result, fileOperationErrorMappings);
    return true;
  });

  // Example 2: Silent handling of specific errors (like user cancellation)
  procedure.mutation(async () => {
    const result = await dialogService.showOpenDialog();
    const dialogResult = handleResultErrorWithSilent(
      result,
      ['canceled'],
      fileOperationErrorMappings,
    );
    if (dialogResult !== null) {
      // Process successful result
      eventEmitter.emit('toast', 'Operation completed successfully');
    }
    return true;
  });
  ```

### For direct error throwing:

- **If you want to show a specific message to the user for a known error condition:**
  - Throw an instance of `UserFacingError` (or its subclasses like `OperationFailedError`).
  - The `message` you provide to the error constructor will be displayed to the user.
  - Example:
    ```typescript
    import { UserFacingError, OperationFailedError } from '../lib/errors';
    // ... in a tRPC procedure
    if (someConditionFails) {
      throw new UserFacingError('Specific error message for the user.');
    }
    if (anotherOperationFails) {
      throw new OperationFailedError(
        'My Operation',
        'Detailed reason for failure.',
      );
    }
    ```

- **For unexpected errors or errors you don't intend the user to see specific details of:**
  - Simply let the original error propagate (or throw a standard `Error`).
  - The system will automatically catch it, display a generic "予期しないエラーが発生しました。" message to the user, and send the full technical details to Sentry.
  - Example:
    ```typescript
    // ... in a tRPC procedure
    try {
      const result = await someThirdPartyLibCall();
      if (!result.success) {
        // This will be treated as an unexpected error by default
        throw new Error('Third party library failed unexpectedly.');
      }
    } catch (e) {
      // Let it propagate, or re-throw if you add context
      throw new Error('Something went wrong during complex_process', {
        cause: e,
      });
    }
    ```

- **Sentry Test Error**:
  - To test Sentry integration, throw an error whose message includes "test error for Sentry" or whose `name` is `SentryTestError`.
  - The `throwErrorForSentryTest` procedure in `settingsController.ts` is an example of this.

### For service layer (neverthrow Results):

Continue using neverthrow's Result pattern for detailed error handling:

```typescript
// In service files
export const getFileData = async (
  filePath: string,
): Promise<Result<string, 'ENOENT' | 'PERMISSION_DENIED'>> => {
  try {
    const data = await fs.readFile(filePath);
    return ok(data.toString());
  } catch (error) {
    if (error.code === 'ENOENT') {
      return err('ENOENT' as const);
    }
    if (error.code === 'EACCES') {
      return err('PERMISSION_DENIED' as const);
    }
    // For unexpected errors, throw rather than return err()
    throw error;
  }
};
```

## Frontend Error Display (`src/v2/App.tsx`)

- The `ToasterWrapper` component in `App.tsx` subscribes to toast events emitted from the main process (`eventEmitter.on('toast', ...)`).
- Additionally, when a tRPC query/mutation fails, the `onError` callbacks (e.g., in `useMutation`, `useQuery`) receive the error object formatted by the `errorFormatter`. The `message` property of this error object is typically used with `toast()` from `useToast` to display notifications.

This setup ensures that user-facing messages are controlled and appropriate, while developers retain full insight into all errors via Sentry.
