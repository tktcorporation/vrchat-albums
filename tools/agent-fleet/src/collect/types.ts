// 各データ源は「読めた値」か「分類済みの失敗」を返す。失敗を投げないのは、
// 1 つの源（Herdr 未起動など）が落ちても他の源の行を出し続けるため。
export type SourceErrorType = 'not_running' | 'timeout' | 'parse_error' | 'not_found' | 'io_error';
export type SourceError = { type: SourceErrorType; detail: string };
export type SourceResult<T> = { ok: true; value: T } | { ok: false; error: SourceError };

export const ok = <T>(value: T): SourceResult<T> => ({ ok: true, value });
export const fail = <T>(type: SourceErrorType, detail: string): SourceResult<T> => ({
  ok: false,
  error: { type, detail },
});
