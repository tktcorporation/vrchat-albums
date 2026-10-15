/**
 * 「時刻 t がどのワールドセッションに属するか」の判定。
 *
 * セッションは、時刻順に並べたワールド参加ログの隣り合う 2 件で区切る半開区間
 * `[join_i, join_{i+1})` とする。最後のセッションは終わりを持たない（`join_last <= t`）。
 * 境界ちょうどの時刻は後ろのセッションに属し、許容誤差は持たない。
 *
 * 写真のグループ化（renderer）、プレイヤー一覧・プレイヤー検索（main process）が
 * 同じ判定を使うことで、同じ時刻が画面ごとに別のワールドへ振り分けられることを防ぐ。
 * 入力の参加ログは、通常のワールド参加ログと写真由来の参加ログをマージしたものを渡す。
 *
 * Electron・DB・React に依存しない純粋関数だけを置く。日時はローカルタイムの Date
 * をそのまま比較し、UTC への変換は行わない。
 */

/** セッションの区切りになるワールド参加ログが最低限持つ値 */
export interface WorldSessionJoin {
  readonly worldId: string;
  readonly joinDateTime: Date;
}

/** ワールド参加ログ 1 件から次の参加ログの直前までの区間 */
export interface WorldSession<J extends WorldSessionJoin> {
  readonly join: J;
  /** 次の参加ログの日時。最新のセッションでは undefined（終わりを持たない） */
  readonly nextJoinDateTime: Date | undefined;
}

/**
 * 同時刻の参加ログの並びを、呼び出し元の取得順に依存させないための比較。
 * renderer と main process が同じ入力から同じセッション列を作るように、
 * 日時が同じときは worldId で順序を決める。
 */
const compareJoins = (a: WorldSessionJoin, b: WorldSessionJoin): number => {
  const diff = a.joinDateTime.getTime() - b.joinDateTime.getTime();
  if (diff !== 0) {
    return diff;
  }
  if (a.worldId === b.worldId) {
    return 0;
  }
  return a.worldId < b.worldId ? -1 : 1;
};

/**
 * ワールド参加ログからセッション列を作る。
 *
 * 入力の並び順は問わない。戻り値は古い順で、`resolveSessionIndex` の入力になる。
 */
export const buildWorldSessions = <J extends WorldSessionJoin>(
  joins: readonly J[],
): WorldSession<J>[] => {
  const chronological = joins.toSorted(compareJoins);
  return chronological.map((join, index) => ({
    join,
    nextJoinDateTime: chronological[index + 1]?.joinDateTime,
  }));
};

/**
 * 時刻 t が属するセッションの添字を返す（二分探索、O(log n)）。
 *
 * `join_i <= t` を満たす最大の i を探す。同時刻の参加ログが複数あるときは、
 * 並びの後ろ（後のセッション）が選ばれる。
 *
 * @param sessions `buildWorldSessions` が返した古い順のセッション列
 * @returns t が最初の参加ログより前、またはセッションが無いときは null
 */
export const resolveSessionIndex = <J extends WorldSessionJoin>(
  sessions: readonly WorldSession<J>[],
  t: Date,
): number | null => {
  const target = t.getTime();
  let low = 0;
  let high = sessions.length;
  // 不変条件: [0, low) の join は target 以下、[high, length) の join は target より後
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sessions[mid].join.joinDateTime.getTime() <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low === 0 ? null : low - 1;
};

/**
 * 時刻 t が属するセッションを返す。
 *
 * @returns t が最初の参加ログより前、またはセッションが無いときは null
 */
export const resolveSession = <J extends WorldSessionJoin>(
  sessions: readonly WorldSession<J>[],
  t: Date,
): WorldSession<J> | null => {
  const index = resolveSessionIndex(sessions, t);
  return index === null ? null : sessions[index];
};

/**
 * 開始日時がちょうど start のセッションを返す。
 *
 * ギャラリーのグループはセッションの開始日時をキーに持つ。そのキーから
 * グループ自身の区間 `[join, nextJoin)` を引くときに使い、時刻からの再判定はしない。
 *
 * @returns start で始まるセッションが無いときは null
 */
export const findSessionStartingAt = <J extends WorldSessionJoin>(
  sessions: readonly WorldSession<J>[],
  start: Date,
): WorldSession<J> | null => {
  const session = resolveSession(sessions, start);
  if (session === null) {
    return null;
  }
  return session.join.joinDateTime.getTime() === start.getTime()
    ? session
    : null;
};
