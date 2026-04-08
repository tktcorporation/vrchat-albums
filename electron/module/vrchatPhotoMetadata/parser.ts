/**
 * VRChat 写真メタデータパーサー
 *
 * VRChat公式 (2025.3.1以降) が XMP 形式で写真に埋め込むメタデータを
 * exiftool-vendored で読み取り、型安全にパースする。
 *
 * @see electron/module/vrchatPhotoMetadata/schema.ts - メタデータの Zod スキーマ定義
 */

import { Effect } from 'effect';

import { MetadataParseError, NoMetadataFound } from './errors';
import { type VRChatPhotoMetadata, VRChatPhotoMetadataSchema } from './schema';

// ============================================================================
// VRChat公式メタデータ (XMP) パーサー
// ============================================================================

/*
 * VRChat 2025.3.1 で導入された XMP フィールド:
 * - AuthorID (vrc:AuthorID): 撮影者ユーザーID
 * - Author: 撮影者表示名
 * - WorldID (vrc:WorldID): ワールドID
 * - WorldDisplayName (vrc:WorldDisplayName): ワールド表示名
 *
 * exiftool-vendored は XMP カスタムネームスペースのフィールドを
 * 複数の名前で返す可能性がある（例: AuthorID, vrc:AuthorID）。
 * resolveStringTag で候補を統一し、extractOfficialMetadata で Zod 検証する。
 */

/**
 * exiftool Tags から指定キーの候補値を正規化して string | null に変換するヘルパー
 */
const resolveStringTag = (
  // biome-ignore lint/suspicious/noExplicitAny: exiftool Tags の型は広すぎるため any で受ける
  tags: Record<string, any>,
  ...keys: string[]
): string | null => {
  for (const key of keys) {
    const value: unknown = tags[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
};

/**
 * exiftool の Tags オブジェクトから VRChat 公式メタデータを抽出する
 *
 * AuthorID が存在しなければ VRChat メタデータなしと判断して null を返す。
 * Zod スキーマで最終検証する（Parse Don't Validate）。
 */
export const extractOfficialMetadata = (
  // biome-ignore lint/suspicious/noExplicitAny: exiftool Tags の型は広すぎるため any で受ける
  tags: Record<string, any>,
): VRChatPhotoMetadata | null => {
  // AuthorID がなければ VRChat メタデータなしと判断（最低限の存在チェック）
  const authorId = resolveStringTag(tags, 'AuthorID', 'vrc:AuthorID');
  if (!authorId) {
    return null;
  }

  const authorDisplayName =
    resolveStringTag(tags, 'Author', 'Creator', 'xmp:Creator', 'dc:creator') ??
    authorId;

  const worldId = resolveStringTag(
    tags,
    'WorldID',
    'vrc:WorldID',
    'VRCWorldID',
  );
  const worldDisplayName = resolveStringTag(
    tags,
    'WorldDisplayName',
    'vrc:WorldDisplayName',
    'VRCWorldDisplayName',
  );

  // Zod スキーマで最終検証（Parse Don't Validate）
  const parsed = VRChatPhotoMetadataSchema.safeParse({
    authorId,
    authorDisplayName,
    worldId,
    worldDisplayName,
  });

  if (!parsed.success) {
    return null;
  }

  return parsed.data;
};

/**
 * VRChat 写真ファイルから公式XMPメタデータを読み取る
 *
 * exiftool のインスタンスは外部から注入する設計。
 * これにより、複数ファイルの処理時にインスタンスを再利用でき、
 * テスト時にモック可能。
 */
export const parsePhotoMetadata = (
  filePath: string,
  // biome-ignore lint/suspicious/noExplicitAny: exiftool Tags の型は広すぎるため any で受ける
  readExifTags: (filePath: string) => Promise<Record<string, any>>,
): Effect.Effect<VRChatPhotoMetadata, NoMetadataFound | MetadataParseError> =>
  Effect.gen(function* () {
    const tags = yield* Effect.tryPromise({
      try: () => readExifTags(filePath),
      catch: (e) =>
        new MetadataParseError({
          photoPath: filePath,
          message: `Failed to read EXIF/XMP from ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
        }),
    });

    const metadata = extractOfficialMetadata(tags);
    if (metadata === null) {
      return yield* Effect.fail(new NoMetadataFound({ photoPath: filePath }));
    }

    return metadata;
  });

/**
 * 個別ファイルの EXIF 読み取りにタイムアウトを付与するラッパー。
 *
 * 背景: ExifTool インスタンスは taskTimeoutMillis: 30_000 で設定されており、
 * ハングしたタスクを30秒でタイムアウトしプロセスを再起動する。
 * ただしプロセスレベルの問題では発火しないケースがあるため、
 * Promise.race で35秒の二重タイムアウトを設ける（taskTimeoutMillis より5秒長く、
 * プロセス再起動が完了するのを待ってから強制終了する）。
 */
const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(new Error(`EXIF read timeout after ${timeoutMs}ms: ${label}`)),
        timeoutMs,
      );
    }),
  ]);
};

/** バッチ処理の進捗をログ出力する間隔（ファイル数） */
const PROGRESS_LOG_INTERVAL = 100;

/**
 * 複数の写真からメタデータをバッチ抽出する
 *
 * メモリ使用量を抑えるため、並列数を制限して処理する。
 * 個別のファイルでエラーが発生しても、他のファイルの処理は継続する。
 * 進捗状況とエラーをログに記録し、処理の可観測性を確保する。
 */
export const parsePhotoMetadataBatch = async (
  filePaths: string[],
  // biome-ignore lint/suspicious/noExplicitAny: exiftool Tags の型は広すぎるため any で受ける
  readExifTags: (filePath: string) => Promise<Record<string, any>>,
  concurrency = 5,
  onProgress?: (processed: number, total: number, errors: number) => void,
): Promise<Map<string, VRChatPhotoMetadata>> => {
  const results = new Map<string, VRChatPhotoMetadata>();
  const total = filePaths.length;
  let processed = 0;
  let parseErrors = 0;

  /** readExifTags に 35秒のタイムアウトを付与したラッパー（taskTimeoutMillis:30s の5秒後） */
  const readExifTagsWithTimeout = (filePath: string) =>
    withTimeout(readExifTags(filePath), 35_000, filePath);

  // 並列数制限付きで処理
  for (let i = 0; i < filePaths.length; i += concurrency) {
    const batch = filePaths.slice(i, i + concurrency);
    const promises = batch.map(async (filePath) => {
      const result = await Effect.runPromiseExit(
        parsePhotoMetadata(filePath, readExifTagsWithTimeout),
      );
      if (result._tag === 'Success') {
        results.set(filePath, result.value);
      } else if (
        result._tag === 'Failure' &&
        '_tag' in result.cause &&
        result.cause._tag === 'Fail' &&
        typeof result.cause.error === 'object' &&
        result.cause.error !== null &&
        '_tag' in result.cause.error &&
        result.cause.error._tag === 'MetadataParseError'
      ) {
        // NoMetadataFound はメタデータ非対応の写真なので正常系（カウント不要）
        // MetadataParseError は EXIF 読み取り失敗なのでカウント
        parseErrors++;
      }
    });
    await Promise.all(promises);
    processed += batch.length;

    // 定期的に進捗をコールバック通知
    if (
      processed % PROGRESS_LOG_INTERVAL < concurrency ||
      processed === total
    ) {
      onProgress?.(processed, total, parseErrors);
    }
  }

  return results;
};
