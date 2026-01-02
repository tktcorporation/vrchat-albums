import * as path from 'node:path';
import * as datefns from 'date-fns';
import { z } from 'zod';
import { BaseValueObject } from '../../lib/baseValueObject.js';

// Re-export Branded Types from shared module
export {
  OptionalVRChatPlayerIdSchema,
  type VRChatLogLine,
  VRChatLogLineSchema,
  type VRChatPlayerId,
  VRChatPlayerIdSchema,
  type VRChatPlayerName,
  VRChatPlayerNameSchema,
  type VRChatWorldId,
  VRChatWorldIdSchema,
  type VRChatWorldName,
  VRChatWorldNameSchema,
} from '../../lib/brandedTypes.js';
// Re-export validation functions from shared module
export {
  isValidVRChatPlayerId,
  isValidVRChatPlayerName,
  isValidVRChatWorldId,
  isValidVRChatWorldInstanceId,
  isValidVRChatWorldName,
} from '../../lib/vrchatIdValidation.js';

export { BaseValueObject }; // Re-export for backward compatibility

// Import validation function for VRChatWorldInstanceId
import { isValidVRChatWorldInstanceId } from '../../lib/vrchatIdValidation.js';

/**
 * VRChatのログ行の保存先（標準形式）
 * 例: logStore-2024-05.txt
 *
 * メソッドを持つため、クラスベースの ValueObject として維持
 */
class VRChatLogStoreFilePath extends BaseValueObject<
  'VRChatLogStoreFilePath',
  string
> {
  /**
   * ファイルパスから年月を取得する
   * @returns yyyy-MM形式の文字列、または取得できない場合はnull
   */
  public getYearMonth(): string | null {
    // レガシーファイルの場合はnullを返す
    if (
      this.value.endsWith('/logStore.txt') ||
      this.value.endsWith('\\logStore.txt')
    ) {
      return null;
    }

    const match = this.value.match(/logStore-(\d{4}-\d{2})(?:-\d{14})?\.txt$/);
    return match ? match[1] : null;
  }

  /**
   * タイムスタンプ付きのログファイルかどうかを判定する
   */
  public hasTimestamp(): boolean {
    return /logStore-\d{4}-\d{2}-\d{14}\.txt$/.test(this.value);
  }

  /**
   * タイムスタンプを取得する（タイムスタンプがない場合はnull）
   */
  public getTimestamp(): Date | null {
    const match = this.value.match(/logStore-\d{4}-\d{2}-(\d{14})\.txt$/);
    if (!match) return null;

    return datefns.parse(match[1], 'yyyyMMddHHmmss', new Date());
  }
}

/**
 * タイムスタンプ付きのログファイルパスを作成する
 * @param yearMonth yyyy-MM形式の文字列
 * @param timestamp タイムスタンプ（省略時は現在時刻）
 * @returns ファイルパス文字列
 */
export const createTimestampedLogFilePath = (
  basePath: string,
  yearMonth: string,
  timestamp: Date = new Date(),
): string => {
  const timestampStr = datefns.format(timestamp, 'yyyyMMddHHmmss');
  return path.join(basePath, `logStore-${yearMonth}-${timestampStr}.txt`);
};

/**
 * VRChatワールドインスタンスID
 *
 * メソッドを持つため、クラスベースの ValueObject として維持
 */
class VRChatWorldInstanceId extends BaseValueObject<
  'VRChatWorldInstanceId',
  string
> {
  /**
   * インスタンスタイプを取得する
   * @returns インスタンスタイプ、または取得できない場合はnull
   */
  public getInstanceType(): string | null {
    // インスタンスIDに~が含まれていない場合はPublicインスタンス
    if (!this.value.includes('~')) {
      return 'public';
    }

    // ~以降の部分を取得
    const parts = this.value.split('~');
    if (parts.length < 2) {
      return null;
    }

    const typePart = parts[1];

    // 空のtypePartの場合はnullを返す
    if (typePart === '') {
      return null;
    }

    // インスタンスタイプを判定
    if (typePart.startsWith('friends(')) return 'friends';
    if (typePart.startsWith('hidden(')) return 'friends+';
    if (typePart.startsWith('private(')) return 'invite';
    if (typePart.startsWith('group(')) return 'group';
    if (typePart.startsWith('groupPublic(')) return 'group-public';

    // リージョン情報のみの場合はPublic
    if (typePart.match(/^[a-z]{2,3}(\([a-z0-9]+\))?$/)) return 'public';

    // その他の場合
    return 'unknown';
  }

  /**
   * インスタンスタイプのラベルを取得する
   * @returns インスタンスタイプのラベル
   */
  public getInstanceTypeLabel(): string {
    const type = this.getInstanceType();
    switch (type) {
      case 'public':
        return 'Public';
      case 'friends':
        return 'Friends';
      case 'friends+':
        return 'Friends+';
      case 'invite':
        return 'Invite';
      case 'group':
        return 'Group';
      case 'group-public':
        return 'Group Public';
      case 'unknown':
        return 'Unknown';
      default:
        return '';
    }
  }
}

export type { VRChatLogStoreFilePath, VRChatWorldInstanceId };

export const VRChatLogStoreFilePathRegex =
  /(logStore-\d{4}-\d{2}(?:-\d{14})?\.txt$|logStore\.txt$)/;
export const VRChatLogStoreFilePathSchema = z
  .string()
  .superRefine((value, ctx) => {
    if (!VRChatLogStoreFilePathRegex.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid log store file path. Expected format: 'logStore-YYYY-MM.txt', 'logStore-YYYY-MM-YYYYMMDDHHMMSS.txt', or 'logStore.txt'. Received: "${value}"`,
      });
    }
  })
  .transform((value) => {
    return new VRChatLogStoreFilePath(value);
  });

export const VRChatWorldInstanceIdSchema = z
  .string()
  .superRefine((value, ctx) => {
    if (!isValidVRChatWorldInstanceId(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid VRChat World Instance ID format. Expected: alphanumeric string or alphanumeric~region(region_code). Received: "${value}"`,
      });
    }
  })
  .transform((value) => new VRChatWorldInstanceId(value));
