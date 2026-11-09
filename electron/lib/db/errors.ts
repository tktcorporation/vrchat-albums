import { Data } from 'effect';

/**
 * 既存の DB のテーブル定義のうち、自動では直せない食い違い。
 * 直すには利用者のデータを書き換える判断が要るので、DB に触らずに起動を止める。
 */
export type IrreconcilableSchemaIssue =
  | {
      /** 列の型の親和性（TEXT / INTEGER など）が違う */
      kind: 'COLUMN_TYPE_MISMATCH';
      table: string;
      column: string;
      expected: string;
      actual: string;
    }
  | {
      /** NOT NULL で既定値の無い列が無い。既存の行に入れる値を決められないので追加できない */
      kind: 'MISSING_NOT_NULL_COLUMN';
      table: string;
      column: string;
    }
  | {
      /** null を許す列が、既存の DB では NOT NULL になっている。アプリが null を書くと失敗する */
      kind: 'UNEXPECTED_NOT_NULL';
      table: string;
      column: string;
    }
  | {
      /** 主キーの列が違う */
      kind: 'PRIMARY_KEY_MISMATCH';
      table: string;
      column: string;
    }
  | {
      /** アプリが知らない NOT NULL で既定値の無い列がある。アプリの INSERT が失敗する */
      kind: 'EXTRA_NOT_NULL_COLUMN';
      table: string;
      column: string;
    }
  | {
      /** 同じ名前のインデックスが、別の列や一意性で作られている */
      kind: 'INDEX_DEFINITION_CONFLICT';
      table: string;
      index: string;
    }
  | {
      /**
       * NOT NULL のはずの列が既存の DB では NULL 可で、NULL の行が既にある。
       * アプリはこの列を必ず値のあるもの（日時や文字列）として読むので、NULL を読むと壊れた値になる
       */
      kind: 'NULL_IN_NOT_NULL_COLUMN';
      table: string;
      column: string;
    }
  | {
      /**
       * 衝突先を指定して更新する INSERT（`onConflictDoUpdate`）を使うテーブルに、アプリが知らない
       * 一意インデックスがある。そのインデックスに当たった行は更新にならず、INSERT 全体が失敗する
       */
      kind: 'EXTRA_UNIQUE_INDEX_ON_UPSERT_TABLE';
      table: string;
      index: string;
    };

/** 既存の DB に、自動では直せない食い違いがあった。DB には何も書いていない */
export class LegacySchemaIrreconcilable extends Data.TaggedError(
  'LegacySchemaIrreconcilable',
)<{
  readonly message: string;
  readonly issues: readonly IrreconcilableSchemaIssue[];
}> {}

/** 引き継ぎの前の DB の複製に失敗した。DB には何も書いていない */
export class LegacyBackupFailed extends Data.TaggedError('LegacyBackupFailed')<{
  readonly message: string;
  readonly backupPath: string;
  readonly cause: unknown;
}> {}

/** 定義の補修か適用済みの記録の途中で失敗した。トランザクションを巻き戻したので DB は元のまま */
export class LegacyTakeoverFailed extends Data.TaggedError(
  'LegacyTakeoverFailed',
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

/**
 * 複製を残した後で、引き継ぎを終えられなかった（食い違いが直せない、または補修が失敗した）。
 * DB は引き継ぐ前のまま残っているので、次に起動しても同じところで止まる。
 * 呼び出し元は複製の場所を示したうえで、DB を作り直すか起動を止めるかを決める。
 */
export class LegacyTakeoverIncomplete extends Data.TaggedError(
  'LegacyTakeoverIncomplete',
)<{
  readonly message: string;
  /** 引き継ぐ前の DB の複製 */
  readonly backupPath: string;
  readonly reason: LegacySchemaIrreconcilable | LegacyTakeoverFailed;
}> {}

export type LegacyTakeoverError =
  | LegacySchemaIrreconcilable
  | LegacyBackupFailed
  | LegacyTakeoverFailed
  | LegacyTakeoverIncomplete;

/**
 * 引き継げなかった DB を作り直せない。DB には、ログの保存先や写真のフォルダから作り直せない
 * テーブルがある（`TABLE_REBUILD_SOURCES` が `none` のテーブル）。DB は引き継ぐ前のまま残す
 */
export class LegacyDatabaseNotRebuildable extends Data.TaggedError(
  'LegacyDatabaseNotRebuildable',
)<{
  readonly message: string;
  readonly backupPath: string;
  readonly nonDerivableTables: readonly string[];
  readonly reason: LegacySchemaIrreconcilable | LegacyTakeoverFailed;
}> {}

/** 引き継げなかった DB を退避して作り直す途中で失敗した。退避できなかった DB は元の場所に残る */
export class LegacyDatabaseRebuildFailed extends Data.TaggedError(
  'LegacyDatabaseRebuildFailed',
)<{
  readonly message: string;
  readonly backupPath: string;
  readonly cause: unknown;
}> {}
