import {
  type CreationOptional,
  DataTypes,
  type InferAttributes,
  type InferCreationAttributes,
  Model,
} from '@sequelize/core';
import {
  Attribute,
  AutoIncrement,
  Default,
  NotNull,
  PrimaryKey,
  Table,
} from '@sequelize/core/decorators-legacy';

@Table({ tableName: 'Migrations' })
export class Migrations extends Model<
  InferAttributes<Migrations>,
  InferCreationAttributes<Migrations>
> {
  @Attribute(DataTypes.INTEGER)
  @PrimaryKey
  @AutoIncrement
  declare id: CreationOptional<number>;

  @Attribute(DataTypes.STRING)
  @NotNull
  declare version: string;

  @Attribute(DataTypes.DATE)
  @NotNull
  declare migratedAt: Date;

  /**
   * 同期時点のモデル定義から算出したスキーマ指紋（`computeSchemaFingerprint`）。
   * 起動時にこの値と現在のモデルの指紋を比べ、異なるときだけ `sync({ alter: true })` を実行する。
   * 値が null の行は、指紋が未記録として同期が必要と判定される。
   */
  @Attribute(DataTypes.STRING)
  declare schemaFingerprint: CreationOptional<string | null>;

  @Attribute(DataTypes.DATE)
  @Default(DataTypes.NOW)
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
