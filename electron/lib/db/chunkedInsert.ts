import { getTableColumns } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import type { DBExecutor } from './client';

/**
 * SQLite が 1 つの文に束縛できるパラメータの上限（`SQLITE_MAX_VARIABLE_NUMBER` の既定値）。
 * 複数行の INSERT は「行数 × 列数」のパラメータを束縛するので、これを超えると
 * `too many SQL variables` で文全体が失敗する。
 */
const SQLITE_MAX_BOUND_PARAMETERS = 32_766;

/**
 * 1 つの INSERT に載せる行数の上限。パラメータの上限より手前で切るのは、
 * 1 文が大きいほど SQL の組み立てと解析に時間がかかり、その間 DB を使う処理全体が止まるため。
 */
const MAX_ROWS_PER_INSERT = 1000;

/**
 * `table` への複数行の INSERT で、1 文に載せてよい行数。
 *
 * Drizzle は値を渡さなかった列も既定値の関数（`$defaultFn`）で埋めて束縛するので、
 * 1 行あたりのパラメータ数はテーブルの列数を上限として見積もる。
 */
export const rowsPerInsert = (table: SQLiteTable): number => {
  const columnCount = Object.keys(getTableColumns(table)).length;
  return Math.max(
    1,
    Math.min(
      MAX_ROWS_PER_INSERT,
      Math.floor(SQLITE_MAX_BOUND_PARAMETERS / columnCount),
    ),
  );
};

const chunk = <T>(rows: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) =>
    rows.slice(i * size, (i + 1) * size),
  );

/**
 * 複数行の INSERT を、パラメータの上限に収まる大きさに分けて実行し、各回の戻り値をつなげて返す。
 *
 * 分けた INSERT は 1 つのトランザクションで実行するので、呼び出し元から見ると 1 文の INSERT と
 * 同じく全部が入るか何も入らないかのどちらかになる。`executor` が既にトランザクションなら
 * その中のセーブポイントになり、外側のトランザクションの一部として確定・巻き戻しされる。
 * 1 回に収まる行数なら、トランザクションを張らずにそのまま実行する。
 *
 * @param insertChunk 分けた行を 1 つの INSERT として実行し、その戻り値（`returning()` の行）を返す
 */
export const insertInChunks = <Row, Result>(
  executor: DBExecutor,
  table: SQLiteTable,
  rows: readonly Row[],
  insertChunk: (executor: DBExecutor, rows: Row[]) => Result[],
): Result[] => {
  if (rows.length === 0) {
    return [];
  }
  const chunks = chunk(rows, rowsPerInsert(table));
  if (chunks.length === 1) {
    return insertChunk(executor, chunks[0] ?? []);
  }
  return executor.transaction((tx) =>
    chunks.flatMap((rowsOfChunk) => insertChunk(tx, rowsOfChunk)),
  );
};
