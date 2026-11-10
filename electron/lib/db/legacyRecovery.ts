import { promises as fs } from 'node:fs';

import * as datefns from 'date-fns';
import { Effect } from 'effect';
import path from 'pathe';
import { match } from 'ts-pattern';

import type { TableRebuildSource } from './schema';

/**
 * 引き継げなかった Sequelize の時代の DB を、作り直してよいか。
 *
 * どのテーブルの行も DB の外（ログの保存先・写真のフォルダ）から作り直せるときだけ作り直す。
 * 作り直せないテーブルがあれば、そのテーブルの名前を返して起動を止めさせる。
 */
export type LegacyRecoveryPlan =
  | { kind: 'rebuild' }
  | { kind: 'stop'; nonDerivableTables: string[] };

export const planLegacyRecovery = (
  sources: Readonly<Record<string, TableRebuildSource>>,
): LegacyRecoveryPlan => {
  const nonDerivableTables = Object.entries(sources)
    .filter(([, source]) => source === 'none')
    .map(([table]) => table);
  return nonDerivableTables.length === 0
    ? { kind: 'rebuild' }
    : { kind: 'stop', nonDerivableTables };
};

/** 退避した DB のファイル名の接頭辞。引き継ぎの前の複製（`db-before-drizzle-`）と区別する */
const SET_ASIDE_PREFIX = 'db-unrecoverable-';

/** SQLite が DB の本体の横に置くファイル。WAL モードで、閉じ損ねた接続があると残る */
const SIDECAR_SUFFIXES = ['-wal', '-shm'] as const;

/** DB を退避できなかった。`movedMainFile` が false なら、DB は元の場所にそのまま残っている */
export interface SetAsideFailed {
  movedMainFile: boolean;
  cause: unknown;
}

/**
 * 閉じた DB のファイルを `<backupDir>/db-unrecoverable-<日時>.sqlite` へ移す。
 * `-wal` と `-shm` があれば、同じ名前に付けて一緒に移す。
 *
 * 消さずに移すのは、引き継ぎの前の複製を作った後で何が起きたかを、後から確かめられるようにするため。
 * 接続を閉じてから呼ぶ。開いたまま移すと、接続が移した先のファイルへ書き続ける。
 * 本体を移した後で `-wal` か `-shm` を移せなかったときは失敗を返す。残ったファイルの横に新しい DB を
 * 作ると、SQLite が別の DB の WAL を読み込んでしまうため、呼び出し元は新しい DB を作らずに止める。
 *
 * @returns 移した先の DB の本体のパス
 */
export const setAsideLegacyDatabase = (props: {
  dbPath: string;
  backupDir: string;
  now: Date;
}): Effect.Effect<string, SetAsideFailed> => {
  let movedMainFile = false;
  const setAsidePath = path.join(
    props.backupDir,
    `${SET_ASIDE_PREFIX}${datefns.format(props.now, "yyyyMMdd'T'HHmmssSSS")}.sqlite`,
  );
  return Effect.tryPromise({
    try: async () => {
      await fs.mkdir(props.backupDir, { recursive: true });
      // 本体を先に移す。本体を移せなければ何も動かさずに終わり、元の DB をそのまま開き直せる
      await fs.rename(props.dbPath, setAsidePath);
      movedMainFile = true;
      for (const suffix of SIDECAR_SUFFIXES) {
        await fs
          .rename(`${props.dbPath}${suffix}`, `${setAsidePath}${suffix}`)
          .catch((error: unknown) =>
            match(error)
              // 接続を正しく閉じると SQLite が消すので、無いのが普通
              .with({ code: 'ENOENT' }, () => undefined)
              .otherwise((e) => {
                throw e;
              }),
          );
      }
      return setAsidePath;
    },
    catch: (cause): SetAsideFailed => ({ movedMainFile, cause }),
  });
};
