import { createHash } from 'node:crypto';

import type {
  IndexOptions,
  ModelStatic,
  NormalizedAttributeOptions,
  TableNameWithSchema,
} from '@sequelize/core';

/**
 * `Model.sync()` が DDL を組み立てるときに呼ぶクエリジェネレータのメソッド。
 *
 * Sequelize v7 の型定義は `attributesToSQL` の引数を `describeTable` の結果型として宣言し、
 * `addIndexQuery` を宣言していない。実装は正規化済みの属性とインデックス定義を受け取るため、
 * 実装どおりのシグネチャをここで宣言し、`hasDdlMethods` で存在を確かめてから使う。
 */
interface DdlQueryGenerator {
  attributesToSQL: (
    attributes: Record<string, NormalizedAttributeOptions>,
    options: { table: TableNameWithSchema; context: 'createTable' },
  ) => Record<string, string>;
  addIndexQuery: (table: TableNameWithSchema, options: IndexOptions) => string;
}

const hasDdlMethods = (generator: object): generator is DdlQueryGenerator =>
  'attributesToSQL' in generator &&
  typeof generator.attributesToSQL === 'function' &&
  'addIndexQuery' in generator &&
  typeof generator.addIndexQuery === 'function';

/**
 * モデル定義が宣言するスキーマを、DB 方言の DDL 断片で正規化した文字列にする。
 *
 * 列定義は Sequelize の `attributesToSQL`、インデックスは `addIndexQuery` の出力を使う。
 * どちらも `Model.sync()` が実際に発行する DDL と同じ生成経路なので、型・NOT NULL・
 * DEFAULT・UNIQUE・PRIMARY KEY・インデックスの差分がそのまま文字列の差分になる。
 * 方言上で同じ列型になる違い（SQLite での STRING と TEXT など）は同じ文字列になる。
 * 関数で与えるデフォルト値（uuidv7・NOW）は DDL に現れないため、起動ごとに揺れない。
 *
 * テーブル・列・インデックスはそれぞれ名前で並べ替える。モデル内の宣言順を入れ替えただけでは
 * DB に適用すべき差分は生じないので、指紋も変えない。
 */
export const describeModelSchemas = (
  models: readonly ModelStatic[],
): string => {
  const tables = models.map((model) => {
    const queryGenerator = model.sequelize.queryGenerator;
    if (!hasDdlMethods(queryGenerator)) {
      throw new Error(
        'Sequelize query generator lacks attributesToSQL/addIndexQuery required for the schema fingerprint',
      );
    }
    const table = model.table;

    const columns = Object.entries(
      queryGenerator.attributesToSQL(
        Object.fromEntries(model.modelDefinition.physicalAttributes),
        { table, context: 'createTable' },
      ),
    )
      .map(
        ([columnName, sql]) =>
          `${queryGenerator.quoteIdentifier(columnName)} ${sql}`,
      )
      .toSorted();

    // addIndexQuery は渡したオプションに名前などを書き込むため、モデルが保持する定義を複製して渡す
    const indexes = model
      .getIndexes()
      .map((index) => queryGenerator.addIndexQuery(table, { ...index }))
      .toSorted();

    return [
      `TABLE ${queryGenerator.quoteTable(table)}`,
      ...columns,
      ...indexes,
    ].join('\n');
  });

  return tables.toSorted().join('\n\n');
};

/**
 * スキーマ指紋（`describeModelSchemas` の SHA-256 16 進表記）を返す。
 *
 * アプリのバージョンではなくこの値の変化をスキーマ同期の契機にする。
 * SQLite の `sync({ alter: true })` は差分の有無に関係なく全列でテーブルを作り直すため、
 * モデルが変わっていない更新で同期を走らせると、行数に比例した待ち時間が起動時に生じる。
 */
export const computeSchemaFingerprint = (
  models: readonly ModelStatic[],
): string =>
  createHash('sha256').update(describeModelSchemas(models)).digest('hex');
