import * as datefns from 'date-fns';
import pathe from 'pathe';
import { z } from 'zod';
import { BaseValueObject } from '../../electron/lib/baseValueObject.js';

/**
 * VRChatの写真ファイル名
 * VRChat_2023-10-01_03-01-18.551_2560x1440.png
 *
 * @see docs/photo-grouping-logic.md - 写真グループ化ロジック
 * @see electron/module/vrchatPhoto/model/vrchatPhotoPath.model.ts
 */
class VRChatPhotoFileNameWithExt extends BaseValueObject<
  'VRChatPhotoFileNameWithExt',
  string
> {
  // 写真の撮影日時
  public get photoTakenDateTime(): Date {
    // local time
    const dateTimeStr = this.value.match(
      /\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}/,
    );
    if (dateTimeStr === null) {
      throw new Error(`Invalid VRChat photo file name: ${this.value}`);
    }
    return datefns.parse(dateTimeStr[0], 'yyyy-MM-dd_HH-mm-ss.SSS', new Date());
  }
}

export type { VRChatPhotoFileNameWithExt };

export const VRChatPhotoFileNameWithExtSchema = z
  .string()
  .regex(
    /^VRChat_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}_\d+x\d+\.[a-z]+$/,
    'Invalid VRChat photo file name',
  )
  .transform((value) => {
    return new VRChatPhotoFileNameWithExt(value);
  });

// VRChat photo filename pattern (used in path validation)
const VRCHAT_PHOTO_FILENAME_PATTERN =
  /VRChat_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}_\d+x\d+\.[a-z]+$/;

/**
 * VRChatの写真ファイルパス（フルパス）
 *
 * パスの末尾がVRChat写真のファイル名形式であることを検証済み。
 * 例: /path/to/VRChat/VRChat_2023-10-01_03-01-18.551_2560x1440.png
 *
 * @remarks
 * fileNameとdirPathはコンストラクタ時に計算・キャッシュされる。
 * これにより、頻繁なアクセス時のパース処理オーバーヘッドを削減。
 *
 * @see VRChatPhotoFileNameWithExt - ファイル名のみのValueObject
 */
class VRChatPhotoPath extends BaseValueObject<'VRChatPhotoPath', string> {
  private readonly _fileName: VRChatPhotoFileNameWithExt;
  private readonly _dirPath: string;

  constructor(value: string) {
    super(value);
    // 派生プロパティをコンストラクタ時にキャッシュ
    const basename = pathe.basename(value);
    this._fileName = VRChatPhotoFileNameWithExtSchema.parse(basename);
    this._dirPath = pathe.dirname(value);
  }

  /**
   * パスからファイル名部分を取得（キャッシュ済み）
   */
  public get fileName(): VRChatPhotoFileNameWithExt {
    return this._fileName;
  }

  /**
   * パスからディレクトリ部分を取得（キャッシュ済み）
   */
  public get dirPath(): string {
    return this._dirPath;
  }
}

export type { VRChatPhotoPath };

/**
 * VRChat写真パスかどうかを判定するバリデーション関数
 */
export const isValidVRChatPhotoPath = (value: string): boolean => {
  const basename = pathe.basename(value);
  return VRCHAT_PHOTO_FILENAME_PATTERN.test(basename);
};

export const VRChatPhotoPathSchema = z
  .string()
  .refine(
    (value) => {
      const basename = pathe.basename(value);
      return VRCHAT_PHOTO_FILENAME_PATTERN.test(basename);
    },
    { message: 'Invalid VRChat photo path: filename must match VRChat format' },
  )
  .transform((value) => {
    return new VRChatPhotoPath(value);
  });
