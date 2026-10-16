/**
 * 初期化進捗ストリーム（`init-progress`）のペイロード定義。
 *
 * メインプロセスは表示文言を送らず、ステージ・件数・統計といった翻訳不要のデータだけを送る。
 * 文言はレンダラーが `stage` と `details.unit` から i18n で組み立てる。
 * 型の一元管理と subscription 側のランタイム検証を兼ねる。
 */
import { z } from 'zod';

/**
 * 進捗を持つ処理ステージ。配列の順序がそのまま実行順で、1 回の実行（run）の中では
 * この順にしか送られない（途中のステージは処理対象が無ければ送られないことがある）。
 */
export const PROGRESS_STAGES = [
  'database_sync',
  'log_append',
  'log_load',
  'photo_index',
  'photo_metadata',
  'photo_log_import',
] as const;

export const ProgressStageSchema = z.enum(PROGRESS_STAGES);
export type ProgressStage = z.infer<typeof ProgressStageSchema>;

/**
 * 1 回の実行に属するイベントのステージ。進捗ステージに終端の `completed` / `error` を加えたもの。
 */
export const RunStageSchema = z.enum([
  ...PROGRESS_STAGES,
  'completed',
  'error',
]);
export type RunStage = z.infer<typeof RunStageSchema>;

/**
 * `details.current` / `details.total` が数えている対象。
 * レンダラーが「12 / 128 ファイル」「3,412 / 8,900 枚」のように単位を選ぶために使う。
 */
const ProgressUnitSchema = z.enum(['files', 'logs', 'photos']);

/**
 * ステージ内の実件数。`current` は `total` を超えない。
 */
export const InitProgressDetailsSchema = z
  .object({
    /** 処理済み件数 */
    current: z.number().int().min(0),
    /** 総件数 */
    total: z.number().int().min(0),
    /** 数えている対象 */
    unit: ProgressUnitSchema,
    /**
     * 処理中の対象を表す翻訳不要のデータ。
     * photo_index では処理中の写真の撮影月（`YYYY-MM`）を入れる。
     */
    currentItem: z.string().min(1).optional(),
  })
  .strict()
  .refine((d) => d.current <= d.total, {
    message: 'current must not exceed total',
  });
export type InitProgressDetails = z.infer<typeof InitProgressDetailsSchema>;

/** `YYYY-MM`（ローカルタイム基準の撮影月） */
const YearMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/**
 * DB に登録済みのデータから数えた累計。インデックス中に登録された写真も含む。
 */
export const InitStatsSchema = z
  .object({
    /** 登録済みの写真枚数（`months` の `count` の合計と一致する） */
    photos: z.number().int().min(0),
    /** 訪れたワールドの数（ワールド ID の重複を除く） */
    worlds: z.number().int().min(0),
    /** 出会ったプレイヤーの数（プレイヤー名の重複を除く） */
    people: z.number().int().min(0),
    /** 撮影月ごとの写真枚数。月の昇順で、写真が 1 枚も無い月は含まない */
    months: z.array(
      z
        .object({
          month: YearMonthSchema,
          count: z.number().int().min(1),
        })
        .strict(),
    ),
  })
  .strict();
export type InitStats = z.infer<typeof InitStatsSchema>;

/**
 * 実行の起動種別。DB の準備ができるまで（`database_sync` の間）は判定できないため `null` になり、
 * 判定できた時点以降のすべてのイベントに同じ値が入る。
 */
export const InitLaunchSchema = z
  .object({
    /** `full`: 全件処理（初回起動・写真フォルダ変更時）、`incremental`: 差分処理 */
    syncMode: z.enum(['full', 'incremental']),
    /** DB にワールド参加ログが 1 件も無い状態からの起動か */
    isFirstLaunch: z.boolean(),
  })
  .strict();
export type InitLaunch = z.infer<typeof InitLaunchSchema>;

/**
 * subscription 接続完了の通知。実行に属さないので進捗も統計も持たない。
 */
export const InitReadyPayloadSchema = z
  .object({ stage: z.literal('ready') })
  .strict();

/**
 * 1 回の実行（起動時の初期化、または手動・バックグラウンドのログ同期）に属するイベント。
 *
 * 不変条件（送信側の emitter が保証する）:
 * - 同じ `runId` の中で、ステージは `PROGRESS_STAGES` の順にしか進まない
 * - 同じ `runId`・同じステージの中で、`progress` は減らない
 * - `completed` / `error` はその実行の最後のイベント
 */
export const InitRunPayloadSchema = z
  .object({
    /** 実行ごとに増える ID。レンダラーはこれが変わったら進捗の表示状態を初期化する */
    runId: z.number().int().min(1),
    /** 現在のステージ */
    stage: RunStageSchema,
    /** ステージ内での進捗（0-100） */
    progress: z.number().int().min(0).max(100),
    /** 起動種別（すべてのイベントに入る。判定前は null） */
    launch: InitLaunchSchema.nullable(),
    /** ステージ内の実件数。件数を数えられるステージでのみ入る */
    details: InitProgressDetailsSchema.optional(),
    /**
     * DB 上の累計。更新があったイベントにだけ入り、送信は 1 秒あたり約 10 回までに間引かれる。
     * 受け取った側は最後に受け取った値を保持して使う。
     */
    stats: InitStatsSchema.optional(),
  })
  .strict();
export type InitRunPayload = z.infer<typeof InitRunPayloadSchema>;

/**
 * 初期化進捗イベントのペイロード
 */
export const InitProgressPayloadSchema = z.union([
  InitReadyPayloadSchema,
  InitRunPayloadSchema,
]);
export type InitProgressPayload = z.infer<typeof InitProgressPayloadSchema>;

/**
 * IPCチャンネル名（定数として型安全に管理）
 */
export const INIT_PROGRESS_CHANNEL = 'init-progress' as const;
