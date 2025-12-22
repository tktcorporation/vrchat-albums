import { err, ok, type Result } from 'neverthrow';
import { ofetch } from 'ofetch';
import { match, P } from 'ts-pattern';
import type { QueryObject } from 'ufo';

/**
 * HTTPリクエスト失敗時の詳細情報を保持するエラークラス。
 *
 * @see docs/error-handling.md - エラーハンドリング方針
 * @see fetchWithResult - ofetch のラッパー
 */
export class FetchError extends Error {
  status: number;
  url: string;
  method?: string;
  headers?: Headers;
  responseBody?: unknown;
  originalMessage?: string;

  constructor(
    {
      message,
      status,
      url,
      method,
      headers,
      responseBody,
    }: {
      message: string;
      status: number;
      url: string;
      method?: string;
      headers?: Headers;
      responseBody?: unknown;
    },
    option: { cause?: Error } = {},
  ) {
    super(message, { cause: option.cause });
    this.name = 'FetchError';
    this.status = status;
    this.url = url;
    this.method = method;
    this.headers = headers;
    this.responseBody = responseBody;
    this.originalMessage = message;
  }
}

/**
 * ofetch を利用して HTTP リクエストを行うユーティリティ
 * getData からのみ呼ばれ、成功可否を Result 型で返す
 */
const fetchWithResult = async <T = unknown>(
  url: string,
  options?: RequestInit & { query?: QueryObject },
): Promise<Result<T, FetchError>> => {
  try {
    // ちゃんとした User-Agent を設定する
    const userAgent = `Electron ${process.versions.electron}; ${process.platform}; ${process.arch}`;
    const response = await ofetch<T>(url, {
      headers: {
        'User-Agent': userAgent,
        ...options?.headers,
      },
      ...options,
      onResponseError: async ({ response }) => {
        throw new FetchError({
          message: response.statusText || 'Unknown error',
          status: response.status,
          url: response.url,
          method: options?.method,
          headers: response.headers,
          responseBody: response._data,
        });
      },
    });
    return ok(response);
  } catch (error: unknown) {
    return match(error)
      .with(P.instanceOf(FetchError), (e) => err(e))
      .otherwise((e) => {
        throw e; // FetchError でない場合はそのまま throw する
      });
  }
};

/**
 * fetchWithResult のラッパー関数
 * API サービス層から共通利用される
 */
export const getData = async <T>(
  url: string,
  options?: RequestInit & { query?: QueryObject },
): Promise<Result<T, FetchError>> => {
  return fetchWithResult<T>(url, options);
};
