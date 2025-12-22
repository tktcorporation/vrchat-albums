import * as path from 'node:path';
import * as datefns from 'date-fns';
import { z } from 'zod';
import { BaseValueObject } from './baseValueObject.js';

const opaqueSymbol: unique symbol = Symbol('opaqueSymbol');

/**
 * 基本的なPathObject - 型安全なパス操作を提供する値オブジェクト。
 *
 * @see docs/app-event-export-import.md - エクスポート/インポート仕様
 * @see electron/module/vrchatPhoto/model/vrchatPhotoPath.model.ts - 写真パスモデル
 */
class PathObject extends BaseValueObject<'PathObject', string> {
  /**
   * パスをプラットフォーム固有の形式に正規化
   */
  normalize(): PathObject {
    return new PathObject(path.normalize(this.value));
  }

  /**
   * パスセグメントを安全に結合
   */
  join(...segments: string[]): PathObject {
    return new PathObject(path.join(this.value, ...segments));
  }

  /**
   * 絶対パスに解決
   */
  resolve(): AbsolutePathObject {
    return new AbsolutePathObject(path.resolve(this.value));
  }

  /**
   * 指定されたベースパス内にあるかチェック（ディレクトリトラバーサル防止）
   */
  isWithin(basePath: PathObject): boolean {
    const resolvedThis = path.resolve(this.value);
    const resolvedBase = path.resolve(basePath.value);
    return resolvedThis.startsWith(resolvedBase);
  }

  /**
   * パスからファイル名を取得
   */
  basename(ext?: string): string {
    return path.basename(this.value, ext);
  }

  /**
   * パスからディレクトリ名を取得
   */
  dirname(): PathObject {
    return new PathObject(path.dirname(this.value));
  }

  /**
   * 相対パスを取得
   */
  relative(to: PathObject): PathObject {
    return new PathObject(path.relative(this.value, to.value));
  }

  /**
   * glob用にフォワードスラッシュに正規化
   */
  toGlobPattern(): string {
    return this.value.replace(/\\/g, '/');
  }

  /**
   * パスが絶対パスかチェック
   */
  isAbsolute(): boolean {
    return path.isAbsolute(this.value);
  }
}

/**
 * 絶対パスを保証するPathObject
 */
class AbsolutePathObject extends PathObject {
  // @ts-expect-error TS1338
  private readonly [opaqueSymbol]: 'AbsolutePathObject';
  constructor(value: string) {
    const absolutePath = path.isAbsolute(value) ? value : path.resolve(value);
    super(absolutePath);
  }

  resolve(): AbsolutePathObject {
    return this; // 既に絶対パスなのでそのまま返す
  }
}

/**
 * エクスポートパス専用のPathObject
 */
class ExportPathObject extends PathObject {
  // @ts-expect-error TS1338
  private readonly [opaqueSymbol]: 'ExportPathObject';
  /**
   * エクスポートフォルダ名を抽出（vrchat-albums-export_YYYY-MM-DD_HH-mm-ss）
   */
  extractExportFolderName(): string | null {
    // すべてのパス区切り文字をスラッシュに統一して処理
    const normalizedPath = this.value.replace(/\\/g, '/');
    const parts = normalizedPath.split('/');
    const exportFolder = parts.find((part) =>
      part.startsWith('vrchat-albums-export_'),
    );
    return exportFolder || null;
  }

  /**
   * タイムスタンプ付きサブディレクトリを作成
   */
  withTimestampedSubdir(prefix = 'vrchat-albums-export'): ExportPathObject {
    const now = new Date();
    const timestamp = now
      .toISOString()
      .replace(/T/, '_')
      .replace(/:/g, '-')
      .slice(0, -5);
    const dirname = `${prefix}_${timestamp}`;
    return new ExportPathObject(path.join(this.value, dirname));
  }
}

/**
 * バックアップパス専用のPathObject
 */
class BackupPathObject extends PathObject {
  // @ts-expect-error TS1338
  private readonly [opaqueSymbol]: 'BackupPathObject';
  /**
   * バックアップIDからパスを生成
   */
  withBackupId(backupId: string): BackupPathObject {
    return new BackupPathObject(path.join(this.value, backupId));
  }

  /**
   * インポートバックアップ用のプレフィックスを追加
   */
  withImportBackupPrefix(): BackupPathObject {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `backup_${timestamp}`;
    return new BackupPathObject(path.join(this.value, backupName));
  }
}

/**
 * VRChat写真ディレクトリ専用のPathObject
 */
class VRChatPhotoPathObject extends PathObject {
  // @ts-expect-error TS1338
  private readonly [opaqueSymbol]: 'VRChatPhotoPathObject';
  /**
   * VRChat写真用のglobパターンを生成
   * @param pattern 写真ファイルのパターン（デフォルト: 'VRChat_*_wrld_*'）
   * @returns glob用のパターン文字列
   */
  toPhotoGlobPattern(pattern = 'VRChat_*_wrld_*'): string {
    // パスをフォワードスラッシュに正規化し、再帰的な検索パターンを追加
    const basePath = this.toGlobPattern();
    return `${basePath}/**/${pattern}`;
  }

  /**
   * 写真ファイル名からワールドIDと日時を抽出
   * @param filePath 写真ファイルのパス
   * @returns ワールドIDと参加日時、または null
   */
  extractPhotoInfo(): {
    worldId: string;
    joinDate: Date;
  } | null {
    const regex =
      /VRChat_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3})_wrld_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z]+/;
    const matches = this.value.match(regex);
    if (!matches) {
      return null;
    }

    // ファイル名の日時はlocal timeなので、そのままパース
    const joinDate = datefns.parse(
      matches[1],
      'yyyy-MM-dd_HH-mm-ss.SSS',
      new Date(),
    );
    const worldId = `wrld_${matches[2]}`;

    return { worldId, joinDate };
  }
}

/**
 * export classes
 * ValueObject を直接作ってしまえないように type のみ export する
 */
export type {
  PathObject,
  AbsolutePathObject,
  ExportPathObject,
  BackupPathObject,
  VRChatPhotoPathObject,
};

/**
 * Zodスキーマ
 */
export const PathObjectSchema = z
  .string()
  .transform((val) => new PathObject(val));
export const AbsolutePathObjectSchema = z
  .string()
  .transform((val) => new AbsolutePathObject(val));
export const ExportPathObjectSchema = z
  .string()
  .transform((val) => new ExportPathObject(val));
export const BackupPathObjectSchema = z
  .string()
  .transform((val) => new BackupPathObject(val));
export const VRChatPhotoPathObjectSchema = z
  .string()
  .transform((val) => new VRChatPhotoPathObject(val));
