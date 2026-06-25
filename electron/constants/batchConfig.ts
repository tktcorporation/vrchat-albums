/**
 * セッション情報バッチ取得の最大件数（フロント送信上限 / tRPC 検証上限の単一ソース）。
 *
 * フロントの送信上限（src/v2 の useSessionInfoBatch）と tRPC 入力の検証（`.max`）が
 * この同じ値を参照することで、送信側と検証側の上限が乖離しない（SSOT）。
 * 以前は electron 側と src 側で別々の値（200 / 100）にずれており、フロントの
 * 「max allowed」ログが実際の検証上限と食い違っていた。
 *
 * フロント側（src/v2/constants/batchConfig.ts）もこの値を import する。
 */
export const MAX_SESSION_BATCH_SIZE = 100;
