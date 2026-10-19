import { DataTypes, type ModelAttributes, Sequelize } from '@sequelize/core';
import { SqliteDialect } from '@sequelize/sqlite3';
import { describe, expect, it } from 'vitest';

import {
  computeSchemaFingerprint,
  describeModelSchemas,
} from './schemaFingerprint';

/**
 * 接続を張らずにモデル定義だけを持つ Sequelize インスタンスで、指紋の性質を確かめる。
 * 指紋は DDL の生成だけで決まり、DB への問い合わせを伴わない。
 */
const defineModel = (
  attributes: ModelAttributes,
  options: {
    indexes?: { name: string; fields: string[]; unique?: boolean }[];
  } = {},
) => {
  const sequelize = new Sequelize({
    dialect: SqliteDialect,
    storage: ':memory:',
  });
  return sequelize.define('Sample', attributes, {
    tableName: 'Samples',
    indexes: options.indexes,
  });
};

const baseAttributes: ModelAttributes = {
  id: { type: DataTypes.UUID, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  width: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 720 },
};

describe('computeSchemaFingerprint', () => {
  it('同じ定義からは常に同じ指紋を返す', () => {
    const first = computeSchemaFingerprint([defineModel(baseAttributes)]);
    const second = computeSchemaFingerprint([defineModel(baseAttributes)]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('列とモデルの宣言順には依存しない', () => {
    const { id, name, width } = baseAttributes;
    const reordered = defineModel({ width, name, id });
    const other = new Sequelize({
      dialect: SqliteDialect,
      storage: ':memory:',
    }).define('Other', { id: { type: DataTypes.INTEGER, primaryKey: true } });

    expect(computeSchemaFingerprint([defineModel(baseAttributes), other])).toBe(
      computeSchemaFingerprint([other, reordered]),
    );
  });

  it('関数で与えるデフォルト値は指紋に影響しない', () => {
    let counter = 0;
    const withDynamicDefault = () =>
      defineModel({
        ...baseAttributes,
        token: {
          type: DataTypes.STRING,
          defaultValue: () => `token-${counter++}`,
        },
      });
    expect(computeSchemaFingerprint([withDynamicDefault()])).toBe(
      computeSchemaFingerprint([withDynamicDefault()]),
    );
  });

  it.each<[string, ModelAttributes]>([
    [
      '列の追加',
      {
        ...baseAttributes,
        height: { type: DataTypes.INTEGER, allowNull: true },
      },
    ],
    [
      '型の変更',
      {
        ...baseAttributes,
        name: { type: DataTypes.INTEGER, allowNull: false },
      },
    ],
    [
      'NOT NULL の変更',
      { ...baseAttributes, name: { type: DataTypes.STRING, allowNull: true } },
    ],
    [
      'DEFAULT の変更',
      {
        ...baseAttributes,
        width: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1280,
        },
      },
    ],
    [
      'UNIQUE の追加',
      {
        ...baseAttributes,
        name: { type: DataTypes.STRING, allowNull: false, unique: true },
      },
    ],
  ])('%s で指紋が変わる', (_label, changed) => {
    expect(computeSchemaFingerprint([defineModel(changed)])).not.toBe(
      computeSchemaFingerprint([defineModel(baseAttributes)]),
    );
  });

  it('SQLite 上で同じ列型になる型の違いでは指紋が変わらない', () => {
    // STRING と TEXT はどちらも SQLite の TEXT 列になり、DB に適用すべき差分が無い
    const asText = defineModel({
      ...baseAttributes,
      name: { type: DataTypes.TEXT, allowNull: false },
    });
    expect(computeSchemaFingerprint([asText])).toBe(
      computeSchemaFingerprint([defineModel(baseAttributes)]),
    );
  });

  it('インデックスの追加・変更で指紋が変わる', () => {
    const plain = computeSchemaFingerprint([defineModel(baseAttributes)]);
    const indexed = computeSchemaFingerprint([
      defineModel(baseAttributes, {
        indexes: [{ name: 'SampleNameIndex', fields: ['name'] }],
      }),
    ]);
    const uniqueIndexed = computeSchemaFingerprint([
      defineModel(baseAttributes, {
        indexes: [{ name: 'SampleNameIndex', fields: ['name'], unique: true }],
      }),
    ]);
    const widened = computeSchemaFingerprint([
      defineModel(baseAttributes, {
        indexes: [{ name: 'SampleNameIndex', fields: ['name', 'width'] }],
      }),
    ]);

    expect(new Set([plain, indexed, uniqueIndexed, widened]).size).toBe(4);
  });

  it('正規化文字列は方言の DDL 断片で列とインデックスを表す', () => {
    const description = describeModelSchemas([
      defineModel(baseAttributes, {
        indexes: [{ name: 'SampleNameIndex', fields: ['name'], unique: true }],
      }),
    ]);
    expect(description).toContain('TABLE `Samples`');
    expect(description).toContain('`width` INTEGER NOT NULL DEFAULT 720');
    expect(description).toContain(
      'CREATE UNIQUE INDEX `SampleNameIndex` ON `Samples` (`name`)',
    );
  });
});
