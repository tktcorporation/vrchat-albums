import {
  type CreationOptional,
  col,
  DataTypes,
  fn,
  type InferAttributes,
  type InferCreationAttributes,
  literal,
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

@Table({ tableName: 'VRChatPhotoPathModels' })
/**
 * VRChat写真のパスとメタデータを管理するモデル。
 *
 * @see docs/photo-grouping-logic.md - 写真グループ化ロジック
 * @see VRChatWorldJoinLogModel - ワールド参加ログとの関連
 */
export class VRChatPhotoPathModel extends Model<
  InferAttributes<VRChatPhotoPathModel>,
  InferCreationAttributes<VRChatPhotoPathModel>
> {
  @Attribute(DataTypes.UUID)
  @PrimaryKey
  @Default(uuidv7)
  declare id: CreationOptional<string>;

  // TODO: world id をここに入れる必要はある？
  // もしくは join log に紐づける？

  @Attribute(DataTypes.STRING)
  @NotNull
  @Index({ unique: true })
  declare photoPath: string;

  @Attribute(DataTypes.DATE)
  @NotNull
  declare photoTakenAt: Date;

  // 縦横比
  @Attribute(DataTypes.INTEGER)
  @NotNull
  @Default(720)
  declare height: number;

  @Attribute(DataTypes.INTEGER)
  @NotNull
  @Default(1280)
  declare width: number;

  // declare fileCreatedAt: Date;
  @Attribute(DataTypes.DATE)
  @Default(DataTypes.NOW)
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

interface VRChatPhotoPathCreationAttributes {
  photoPath: string;
  photoTakenAt: Date;
  width: number;
  height: number;
}

/**
 * 写真パス一覧を一括で登録・更新する
 * createVRChatPhotoPathIndex から呼び出される
 */
export const createOrUpdateListVRChatPhotoPath = async (
  attributes: VRChatPhotoPathCreationAttributes[],
): Promise<VRChatPhotoPathModel[]> => {
  const result = await VRChatPhotoPathModel.bulkCreate(
    attributes.map((attribute) => ({
      photoPath: attribute.photoPath,
      photoTakenAt: attribute.photoTakenAt,
      width: attribute.width,
      height: attribute.height,
    })),
    {
      updateOnDuplicate: ['photoPath', 'photoTakenAt'], // 更新するフィールドを指定
    },
  );

  return result;
};

/**
 * VRChatの写真の保存pathを取得する
 * ページネーション対応（オプション）
 *
 * 注意: バーチャルスクロールで高さ計算を行っているため、
 * フロントエンドでページネーションを実装するまでは
 * limit/offset を指定せずに全件取得することを推奨
 *
 * @param query.limit 取得する最大件数（指定しない場合は全件取得）
 * @param query.offset スキップする件数（デフォルト: 0）
 */
export const getVRChatPhotoPathList = async (query?: {
  gtPhotoTakenAt?: Date;
  ltPhotoTakenAt?: Date;
  orderByPhotoTakenAt: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}): Promise<VRChatPhotoPathModel[]> => {
  const photoPathList = await VRChatPhotoPathModel.findAll({
    where: {
      photoTakenAt: {
        ...(query?.gtPhotoTakenAt && { [Op.gt]: query.gtPhotoTakenAt }),
        ...(query?.ltPhotoTakenAt && { [Op.lt]: query.ltPhotoTakenAt }),
      },
    },
    order: [['photoTakenAt', query?.orderByPhotoTakenAt ?? 'asc']],
    // limit が明示的に指定された場合のみ適用（デフォルトは全件取得）
    ...(query?.limit !== undefined && { limit: query.limit }),
    ...(query?.offset !== undefined && { offset: query.offset }),
  });

  return photoPathList;
};

/**
 * 写真の総件数を取得する（ページネーション用）
 */
export const getVRChatPhotoPathCount = async (query?: {
  gtPhotoTakenAt?: Date;
  ltPhotoTakenAt?: Date;
}): Promise<number> => {
  return VRChatPhotoPathModel.count({
    where: {
      photoTakenAt: {
        ...(query?.gtPhotoTakenAt && { [Op.gt]: query.gtPhotoTakenAt }),
        ...(query?.ltPhotoTakenAt && { [Op.lt]: query.ltPhotoTakenAt }),
      },
    },
  });
};

/**
 * photoPath の完全一致でレコードを取得する
 */
export const getVRChatPhotoPathByPhotoPath = async (
  photoPath: string,
): Promise<VRChatPhotoPathModel | null> => {
  return VRChatPhotoPathModel.findOne({
    where: { photoPath },
  });
};

/**
 * モデルインスタンスを削除する
 * validateVRChatPhotoPathModel から利用される
 */
export const deleteVRChatPhotoPathModel = async (
  photoPathModel: VRChatPhotoPathModel,
): Promise<void> => {
  await photoPathModel.destroy();
};

/**
 * 写真枚数を年月単位で集計する
 * vrchatPhotoRouter から統計情報として提供
 */
export const getCountByYearMonthList = async (): Promise<
  {
    photoTakenYear: number;
    photoTakenMonth: number;
    photoCount: number;
  }[]
> => {
  const countResult = await VRChatPhotoPathModel.findAll({
    attributes: [
      [fn('strftime', '%Y-%m', col('photoTakenAt')), 'yearMonth'],
      [fn('COUNT', col('id')), 'photoCount'],
    ],
    group: [literal('yearMonth')],
    order: [[literal('yearMonth'), 'DESC']],
  });

  const converted = countResult.map((record) => ({
    yearMonth: record.get('yearMonth'),
    photoCount: record.get('photoCount'),
  }));

  return converted.map(({ yearMonth, photoCount }) => {
    if (typeof yearMonth !== 'string') {
      throw new Error(`assertion error: ${yearMonth}`);
    }
    const [year, month] = yearMonth.split('-').map(Number);
    if (typeof photoCount !== 'number') {
      throw new Error(`assertion error: ${photoCount}`);
    }
    return { photoTakenYear: year, photoTakenMonth: month, photoCount };
  });
};

/** 最新の写真レコードを取得する */
export const getLatestVRChatPhoto = async () => {
  return VRChatPhotoPathModel.findOne({
    order: [['photoTakenAt', 'DESC']],
  });
};

/**
 * 軽量メタデータ型（ハイブリッドローディング用）
 *
 * @remarks
 * フロントエンド側に同等の型 PhotoMetadata が存在する。
 * tRPC 経由で転送時に Date→string 変換されるため、
 * 各レイヤーで専用の型定義を維持している。
 * 両方の型を変更する場合は、もう一方も更新すること。
 *
 * @see src/v2/types/photo.ts - PhotoMetadata（フロントエンド側）
 */
export interface VRChatPhotoMetadata {
  id: string;
  photoTakenAt: Date;
  width: number;
  height: number;
}

/**
 * 軽量メタデータのみ取得する（初回クエリ用）
 * photoPath を含まないことでメモリ使用量を削減
 *
 * @see docs/photo-grouping-logic.md - 写真グループ化ロジック
 * @see VRChatPhotoMetadata - 戻り値の型定義
 */
export const getVRChatPhotoMetadataList = async (query?: {
  gtPhotoTakenAt?: Date;
  ltPhotoTakenAt?: Date;
  orderByPhotoTakenAt: 'asc' | 'desc';
}): Promise<VRChatPhotoMetadata[]> => {
  const photoList = await VRChatPhotoPathModel.findAll({
    attributes: ['id', 'photoTakenAt', 'width', 'height'], // photoPath を除外
    where: {
      photoTakenAt: {
        ...(query?.gtPhotoTakenAt && { [Op.gt]: query.gtPhotoTakenAt }),
        ...(query?.ltPhotoTakenAt && { [Op.lt]: query.ltPhotoTakenAt }),
      },
    },
    order: [['photoTakenAt', query?.orderByPhotoTakenAt ?? 'asc']],
    raw: true, // プレーンオブジェクトを返す（メモリ効率向上）
  });

  return photoList as VRChatPhotoMetadata[];
};

/**
 * 指定されたIDの写真パスをオンデマンドでバッチ取得
 * 表示に必要な範囲のみ取得することでメモリ使用量を削減
 */
export const getVRChatPhotoPathsByIds = async (
  ids: string[],
): Promise<Map<string, string>> => {
  if (ids.length === 0) {
    return new Map();
  }

  const photos = await VRChatPhotoPathModel.findAll({
    attributes: ['id', 'photoPath'],
    where: {
      id: {
        [Op.in]: ids,
      },
    },
    raw: true,
  });

  const pathMap = new Map<string, string>();
  for (const photo of photos) {
    pathMap.set(photo.id, photo.photoPath);
  }

  return pathMap;
};
