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

export type LegacyTakeoverError =
  | LegacySchemaIrreconcilable
  | LegacyBackupFailed
  | LegacyTakeoverFailed;
