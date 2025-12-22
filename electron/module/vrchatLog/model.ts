import * as path from 'node:path';
import * as datefns from 'date-fns';
import { z } from 'zod';
import { BaseValueObject } from '../../lib/baseValueObject.js';

export { BaseValueObject }; // Re-export for backward compatibility

/**
 * VRChatのログ行
 */
class VRChatLogLine extends BaseValueObject<'VRChatLogLine', string> {}

/**
 * VRChatのログ行の保存先（標準形式）
 * 例: logStore-2024-05.txt
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
 * VRChatプレイヤーIDの検証関数
 * usr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx形式
 */
export const isValidVRChatPlayerId = (value: string): boolean => {
  const regex =
    /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  return regex.test(value);
};

/**
 * VRChatプレイヤーID
 */
class VRChatPlayerId extends BaseValueObject<'VRChatPlayerId', string> {}

/**
 * VRChatワールドIDの検証関数
 * wrld_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx形式
 */
export const isValidVRChatWorldId = (value: string): boolean => {
  const regex =
    /^wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  return regex.test(value);
};

/**
 * VRChatワールドID
 */
class VRChatWorldId extends BaseValueObject<'VRChatWorldId', string> {}

/**
 * VRChatワールドインスタンスIDの検証関数
 * 英数字のみ、または英数字~region(region_code)形式を許可
 */
export const isValidVRChatWorldInstanceId = (value: string): boolean => {
  return /^[a-zA-Z0-9]+(~.+)?$/.test(value);
};

/**
 * VRChatワールドインスタンスID
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

/**
 * VRChatプレイヤー名の検証関数
 * 空文字列ではない文字列
 */
export const isValidVRChatPlayerName = (value: string): boolean => {
  return value.trim().length > 0;
};

/**
 * VRChatプレイヤー名
 */
class VRChatPlayerName extends BaseValueObject<'VRChatPlayerName', string> {}

/**
 * VRChatワールド名の検証関数
 * 空文字列ではない文字列
 */
export const isValidVRChatWorldName = (value: string): boolean => {
  return value.trim().length > 0;
};

/**
 * VRChatワールド名
 */
class VRChatWorldName extends BaseValueObject<'VRChatWorldName', string> {}

export type {
  VRChatLogLine,
  VRChatLogStoreFilePath,
  VRChatPlayerId,
  VRChatWorldId,
  VRChatWorldInstanceId,
  VRChatPlayerName,
  VRChatWorldName,
};

export const VRChatLogLineSchema = z.string().transform((value) => {
  return new VRChatLogLine(value);
});

export const VRChatLogStoreFilePathRegex =
  /(logStore-\d{4}-\d{2}(?:-\d{14})?\.txt$|logStore\.txt$)/;
export const VRChatLogStoreFilePathSchema = z
  .string()
  .regex(
    VRChatLogStoreFilePathRegex,
    "Invalid log store file path. Expected format: 'logStore-YYYY-MM.txt', 'logStore-YYYY-MM-YYYYMMDDHHMMSS.txt', or 'logStore.txt'",
  )
  .transform((value) => {
    return new VRChatLogStoreFilePath(value);
  });

// ID検証用のZodスキーマ
export const VRChatPlayerIdSchema = z
  .string()
  .refine(isValidVRChatPlayerId, {
    message:
      'Invalid VRChat Player ID format. Expected: usr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  })
  .transform((value) => new VRChatPlayerId(value));

export const VRChatWorldIdSchema = z
  .string()
  .refine(isValidVRChatWorldId, {
    error: (issue) => ({
      message: `Invalid VRChat World ID format. Expected: wrld_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx, received: ${issue.input}`,
    }),
  })
  .transform((value) => new VRChatWorldId(value));

export const VRChatWorldInstanceIdSchema = z
  .string()
  .refine(isValidVRChatWorldInstanceId, {
    error: (issue) => ({
      message: `Invalid VRChat World Instance ID format. Expected: alphanumeric string or alphanumeric~region(region_code), received: ${issue.input}`,
    }),
  })
  .transform((value) => new VRChatWorldInstanceId(value));

export const VRChatPlayerNameSchema = z
  .string()
  .refine(isValidVRChatPlayerName, {
    error: (issue) => ({
      message: `Invalid VRChat Player Name. Cannot be empty, received: ${issue.input}`,
    }),
  })
  .transform((value) => new VRChatPlayerName(value));

export const VRChatWorldNameSchema = z
  .string()
  .refine(isValidVRChatWorldName, {
    error: (issue) => ({
      message: `Invalid VRChat World Name. Cannot be empty, received: ${issue.input}`,
    }),
  })
  .transform((value) => new VRChatWorldName(value));

// オプショナルなプレイヤーID用のスキーマ
export const OptionalVRChatPlayerIdSchema = z
  .string()
  .nullable()
  .transform((value) => {
    if (!value) return null;
    return new VRChatPlayerId(value);
  })
  .pipe(
    z.custom<VRChatPlayerId | null>(
      (val): val is VRChatPlayerId | null => {
        if (val === null) return true;
        if (
          val &&
          typeof val === 'object' &&
          'value' in val &&
          typeof val.value === 'string'
        ) {
          return isValidVRChatPlayerId(val.value);
        }
        return false;
      },
      {
        message:
          'Invalid VRChat Player ID format. Expected: usr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      },
    ),
  );
