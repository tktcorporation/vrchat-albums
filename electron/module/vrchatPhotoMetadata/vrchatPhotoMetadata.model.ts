/**
 * VRChat 写真メタデータの DB モデル
 *
 * VRChat公式 (2025.3.1以降) が XMP で写真に埋め込むメタデータを永続化する。
 * VRChatPhotoPathModel と photoPath で 1:1 の関係。
 *
 * @see electron/module/vrchatPhotoMetadata/schema.ts - メタデータの Zod スキーマ定義
 * @see electron/module/vrchatPhotoMetadata/parser.ts - メタデータの抽出・パース処理
 */

import {
  type CreationOptional,
  DataTypes,
  type InferAttributes,
  type InferCreationAttributes,
  Model,
  Op,
} from '@sequelize/core';
import {
  Attribute,
  Default,
  Index,
  NotNull,
  PrimaryKey,
  Table,
} from '@sequelize/core/decorators-legacy';
import { uuidv7 } from 'uuidv7';

@Table({ tableName: 'VRChatPhotoMetadataModels' })
export class VRChatPhotoMetadataModel extends Model<
  InferAttributes<VRChatPhotoMetadataModel>,
  InferCreationAttributes<VRChatPhotoMetadataModel>
> {
  @Attribute(DataTypes.UUID)
  @PrimaryKey
  @Default(uuidv7)
  declare id: CreationOptional<string>;

  /** 写真ファイルのパス (VRChatPhotoPathModel.photoPath と対応) */
  @Attribute(DataTypes.STRING)
  @NotNull
  @Index({ unique: true })
  declare photoPath: string;

  /** 撮影者のVRChatユーザーID (usr_xxx) — メタデータがある = AuthorID が存在する */
  @Attribute(DataTypes.STRING)
  @NotNull
  declare authorId: string;

  /** 撮影者の表示名 — Author フィールドがない場合は authorId がフォールバック値として入る */
  @Attribute(DataTypes.STRING)
  @NotNull
  declare authorDisplayName: string;

  /** ワールドID (wrld_xxx) */
  @Attribute(DataTypes.STRING)
  @Index
  declare worldId: string | null;

  /** ワールドの表示名 */
  @Attribute(DataTypes.STRING)
  declare worldDisplayName: string | null;

  @Attribute(DataTypes.DATE)
  @Default(DataTypes.NOW)
  declare createdAt: CreationOptional<Date>;

  declare updatedAt: CreationOptional<Date>;
}

// ============================================================================
// モデル操作関数
// ============================================================================

export interface VRChatPhotoMetadataCreationAttributes {
  photoPath: string;
  authorId: string;
  authorDisplayName: string;
  worldId: string | null;
  worldDisplayName: string | null;
}

/**
 * メタデータレコードを一括で登録・更新する
 *
 * 同じ photoPath のレコードが既に存在する場合は更新する。
 * 写真インデックス作成時にバッチで呼び出される。
 */
export const createOrUpdatePhotoMetadataBatch = async (
  attributes: VRChatPhotoMetadataCreationAttributes[],
): Promise<VRChatPhotoMetadataModel[]> => {
  if (attributes.length === 0) {
    return [];
  }

  return VRChatPhotoMetadataModel.bulkCreate(attributes, {
    updateOnDuplicate: [
      'authorId',
      'authorDisplayName',
      'worldId',
      'worldDisplayName',
    ],
  });
};

/**
 * 写真パスからメタデータを取得する
 */
export const getPhotoMetadataByPhotoPath = async (
  photoPath: string,
): Promise<VRChatPhotoMetadataModel | null> => {
  return VRChatPhotoMetadataModel.findOne({
    where: { photoPath },
  });
};

/**
 * 複数の写真パスからメタデータをバッチ取得する
 */
export const getPhotoMetadataByPhotoPaths = async (
  photoPaths: string[],
): Promise<VRChatPhotoMetadataModel[]> => {
  if (photoPaths.length === 0) {
    return [];
  }

  return VRChatPhotoMetadataModel.findAll({
    where: {
      photoPath: { [Op.in]: photoPaths },
    },
  });
};

/**
 * ワールドIDからメタデータを取得する (ワールド紐付け用)
 */
export const getPhotoMetadataByWorldId = async (
  worldId: string,
): Promise<VRChatPhotoMetadataModel[]> => {
  return VRChatPhotoMetadataModel.findAll({
    where: { worldId },
    order: [['createdAt', 'ASC']],
  });
};

/**
 * メタデータが既に存在する写真パスの一覧を取得する
 *
 * 差分処理: 既にメタデータ抽出済みの写真をスキップするために使用
 */
export const getPhotoPathsWithMetadata = async (): Promise<Set<string>> => {
  const records = await VRChatPhotoMetadataModel.findAll({
    attributes: ['photoPath'],
    raw: true,
  });

  return new Set(records.map((r) => r.photoPath));
};
