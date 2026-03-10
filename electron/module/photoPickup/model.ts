import {
  type CreationOptional,
  DataTypes,
  type InferAttributes,
  type InferCreationAttributes,
  Model,
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

/**
 * 写真ピックアップ（SNS投稿候補の一時ストック）を管理するモデル。
 *
 * 背景: お気に入りより賞味期限が短い「投稿候補」を一時的にストックする用途。
 * ユーザーが手動でクリアするまで保持される。
 */
@Table({ tableName: 'PhotoPickups' })
export class PhotoPickupModel extends Model<
  InferAttributes<PhotoPickupModel>,
  InferCreationAttributes<PhotoPickupModel>
> {
  @Attribute(DataTypes.UUID)
  @PrimaryKey
  @Default(uuidv7)
  declare id: CreationOptional<string>;

  @Attribute(DataTypes.STRING)
  @NotNull
  @Index({ unique: true })
  declare photoId: string;

  @Attribute(DataTypes.DATE)
  @Default(DataTypes.NOW)
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
