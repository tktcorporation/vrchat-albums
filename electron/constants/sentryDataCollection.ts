/**
 * Sentry へ送るイベントに含めるデータの範囲。main プロセスと renderer の両方の init で使う。
 *
 * SDK は省略した項目を「収集する」側の既定値で補う（ユーザー情報、Cookie、HTTP ヘッダー・本文、
 * URL のクエリ、スタックフレームのローカル変数など）。利用者の特定につながる情報は送らない方針のため、
 * 項目ごとに明示して無効化する。新しい SDK で項目が増えたときは、ここに足して無効化する。
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};
