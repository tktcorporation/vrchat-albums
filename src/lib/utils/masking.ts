import type { Event } from '@sentry/electron/main';

interface ErrorEvent extends Event {
  type: undefined;
}

/**
 * 文字列中のファイルパスに含まれる可能性のあるユーザー名をマスクします。
 * 例: /Users/username/path -> /Users/[REDACTED_USER]/path
 *     C:\Users\username\path -> C:\Users\[REDACTED_USER]\path
 */
function maskFilePaths(str: string | undefined): string | undefined {
  if (!str) {
    return str;
  }
  // macOS / Linux Paths
  let newStr = str.replaceAll(/(\/Users\/)[^/]+(\/)/g, '$1[REDACTED_USER]$2');
  newStr = newStr.replaceAll(/(\/home\/)[^/]+(\/)/g, '$1[REDACTED_USER]$2');
  // Windows Paths
  newStr = newStr.replace(
    /([A-Za-z]:\\Users\\)[^\\]+(\\)/g,
    '$1[REDACTED_USER]$2',
  );
  return newStr;
}

/**
 * Sentry イベントオブジェクト内の主要な箇所に含まれるファイルパスをマスクします。
 */
export function scrubEventData(event: ErrorEvent): ErrorEvent {
  // エラーメッセージ
  if (event.message) {
    event.message = maskFilePaths(event.message);
  }

  // 例外情報
  if (event.exception?.values) {
    for (const value of event.exception.values) {
      if (value.value) {
        value.value = maskFilePaths(value.value);
      }
      // スタックトレースのファイル名
      if (value.stacktrace?.frames) {
        for (const frame of value.stacktrace.frames) {
          if (frame.filename) {
            frame.filename = maskFilePaths(frame.filename);
          }
        }
      }
    }
  }

  // パンくず (Breadcrumbs)
  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) {
      if (breadcrumb.message) {
        breadcrumb.message = maskFilePaths(breadcrumb.message);
      }
      // カテゴリが 'http' や 'fetch' の場合、URLも確認 (必要に応じて)
      // if (breadcrumb.data && breadcrumb.data.url) {
      //   breadcrumb.data.url = maskFilePaths(breadcrumb.data.url as string);
      // }
    }
  }

  // リクエストURL (より広範なマスクが必要な場合)
  if (event.request?.url) {
    event.request.url = maskFilePaths(event.request.url);
  }

  // TODO: 他にマスクが必要なフィールドがあればここに追加
  // 例: event.extra, event.tags など

  return event;
}
