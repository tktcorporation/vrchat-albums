import { trpcReact } from '@/trpc';
import { useMemo } from 'react';
import type { Photo } from '../../types/photo';

interface WorldInfo {
  worldId: string;
  worldName: string;
  worldInstanceId: string;
}

interface Session {
  worldId: string;
  worldName: string;
  worldInstanceId: string;
  joinTime: Date;
  leaveTime?: Date;
  photos: Photo[];
}

export interface GroupedPhoto {
  photos: Photo[];
  worldInfo: WorldInfo | null;
  joinDateTime: Date;
}

export type GroupedPhotos = Record<string, GroupedPhoto>;

export interface WorldJoinLog {
  worldId: string;
  worldName: string;
  worldInstanceId: string;
  joinDateTime: Date;
}

export interface DebugInfo {
  totalPhotos: number;
  totalGroups: number;
  sessionInfo?: {
    totalSessions: number;
    openSessions: number;
    closedSessions: number;
  };
}

/**
 * ログからセッションを構築する（改善版）
 *
 * @param joinLogs ワールド参加ログ（新しい順）
 * @param leaveLogs ワールド退出ログ（利用可能な場合）
 * @returns セッションの配列（新しい順）
 */
function buildSessions(
  joinLogs: WorldJoinLog[],
  leaveLogs: { leaveDateTime: Date; reason?: string }[] = [],
): Session[] {
  const sessions: Session[] = [];

  // 新しい順のログを古い順に処理（時系列順）
  const chronologicalJoins = [...joinLogs].reverse();
  const chronologicalLeaves = [...leaveLogs].sort(
    (a, b) => a.leaveDateTime.getTime() - b.leaveDateTime.getTime(),
  );

  for (let i = 0; i < chronologicalJoins.length; i++) {
    const currentJoin = chronologicalJoins[i];
    const nextJoin = chronologicalJoins[i + 1];

    // このセッションに対応する退出ログを探す
    let sessionLeaveTime: Date | undefined;

    if (leaveLogs.length > 0) {
      // 現在の参加時刻以降で最初の退出ログを探す
      const correspondingLeave = chronologicalLeaves.find(
        (leave) =>
          leave.leaveDateTime.getTime() > currentJoin.joinDateTime.getTime() &&
          (!nextJoin ||
            leave.leaveDateTime.getTime() < nextJoin.joinDateTime.getTime()),
      );
      sessionLeaveTime = correspondingLeave?.leaveDateTime;
    }

    // 退出ログが見つからない場合、次の参加ログを退出時刻として使用
    if (!sessionLeaveTime && nextJoin) {
      sessionLeaveTime = nextJoin.joinDateTime;
    }

    const session: Session = {
      worldId: currentJoin.worldId,
      worldName: currentJoin.worldName,
      worldInstanceId: currentJoin.worldInstanceId,
      joinTime: currentJoin.joinDateTime,
      leaveTime: sessionLeaveTime,
      photos: [],
    };

    sessions.push(session);
  }

  // 新しい順に戻す
  return sessions.reverse();
}

/**
 * 写真をセッションに割り当てる
 *
 * @param photo 割り当てる写真
 * @param sessions セッションの配列（新しい順）
 * @returns 割り当て先のセッション、見つからない場合はnull
 */
function assignPhotoToSession(
  photo: Photo,
  sessions: Session[],
): Session | null {
  const photoTime = photo.takenAt.getTime();

  // 1. 写真撮影時刻に対応するアクティブなセッションを探す
  const activeSession = sessions.find((session) => {
    const joinTime = session.joinTime.getTime();
    const leaveTime = session.leaveTime?.getTime();

    // セッション期間内に撮影された写真
    if (leaveTime) {
      return photoTime >= joinTime && photoTime < leaveTime;
    }
    // 最新のセッション（終了時刻が不明）
    return photoTime >= joinTime;
  });

  if (activeSession) {
    return activeSession;
  }

  // 2. フォールバック: 最も近いセッションを探す
  let closestSession: Session | null = null;
  let minDiff = Number.POSITIVE_INFINITY;

  for (const session of sessions) {
    const joinDiff = Math.abs(session.joinTime.getTime() - photoTime);

    if (joinDiff < minDiff) {
      minDiff = joinDiff;
      closestSession = session;
    }

    // leaveTimeがある場合は、それとの差も考慮
    if (session.leaveTime) {
      const leaveDiff = Math.abs(session.leaveTime.getTime() - photoTime);
      if (leaveDiff < minDiff) {
        minDiff = leaveDiff;
        closestSession = session;
      }
    }
  }

  return closestSession;
}

/**
 * 写真をVRChatのワールドセッション単位でグループ化する
 *
 * @param photos グループ化する写真配列
 * @param joinLogs 降順に並べたワールド参加ログ
 * @returns ワールド情報を含むグループ配列
 */
export function groupPhotosBySession(
  photos: Photo[],
  joinLogs: WorldJoinLog[],
): GroupedPhoto[] {
  if (joinLogs.length === 0) {
    console.warn('No join logs found, unable to group photos by session.');
    return [];
  }

  // セッションを構築
  const sessions = buildSessions(joinLogs);

  // 写真を新しい順にソート
  const sortedPhotos = [...photos].sort(
    (a, b) => b.takenAt.getTime() - a.takenAt.getTime(),
  );

  // 各写真をセッションに割り当て
  for (const photo of sortedPhotos) {
    const session = assignPhotoToSession(photo, sessions);
    if (session) {
      session.photos.push(photo);
    } else {
      console.warn(
        `Could not find appropriate session for photo: ${photo.id} taken at ${photo.takenAt}`,
      );
    }
  }

  // セッションからGroupedPhoto形式に変換
  const groups: GroupedPhoto[] = sessions.map((session) => ({
    photos: session.photos.sort(
      (a, b) => b.takenAt.getTime() - a.takenAt.getTime(),
    ),
    worldInfo: {
      worldId: session.worldId,
      worldName: session.worldName,
      worldInstanceId: session.worldInstanceId,
    },
    joinDateTime: session.joinTime,
  }));

  return groups;
}

/**
 * グループ配列をキー付きのオブジェクトに変換する
 *
 * @param groups グループ化された写真配列
 * @returns `worldId/日時` をキーとしたオブジェクト
 */
function convertGroupsToRecord(groups: GroupedPhoto[]): GroupedPhotos {
  return groups.reduce<GroupedPhotos>((acc, group) => {
    const key = group.worldInfo
      ? `${group.worldInfo.worldId}/${group.joinDateTime.getTime()}`
      : `ungrouped/${group.joinDateTime.getTime()}`;
    acc[key] = group;
    return acc;
  }, {});
}

/**
 * 写真一覧をセッションごとにまとめた結果を返すフック
 *
 * @param photos グループ化対象の写真配列
 * @param onGroupingEnd グループ化処理が完了したときに呼び出されるコールバック
 * @returns グループ化結果と読み込み状態を含むオブジェクト
 */
export function useGroupPhotos(
  photos: Photo[],
  onGroupingEnd?: () => void,
): {
  groupedPhotos: GroupedPhotos;
  isLoading: boolean;
  debug: DebugInfo;
} {
  const { data: joinLogs, isLoading: isLoadingLogs } =
    trpcReact.vrchatWorldJoinLog.getVRChatWorldJoinLogList.useQuery(
      {
        orderByJoinDateTime: 'desc',
      },
      {
        staleTime: 1000 * 60 * 30,
        cacheTime: 1000 * 60 * 60,
      },
    );

  const groupedPhotos = useMemo(() => {
    if (isLoadingLogs || !joinLogs) return {};
    if (joinLogs.length === 0) return {};

    const groups = groupPhotosBySession(photos, joinLogs);
    const result = convertGroupsToRecord(groups);
    onGroupingEnd?.();
    return result;
  }, [photos, joinLogs, isLoadingLogs, onGroupingEnd]);

  const debug: DebugInfo = {
    totalPhotos: photos.length,
    totalGroups: Object.keys(groupedPhotos).length,
  };

  // セッション情報を追加
  if (joinLogs) {
    const sessions = buildSessions(joinLogs);
    debug.sessionInfo = {
      totalSessions: sessions.length,
      openSessions: sessions.filter((s) => !s.leaveTime).length,
      closedSessions: sessions.filter((s) => s.leaveTime).length,
    };
  }

  return {
    groupedPhotos,
    isLoading: isLoadingLogs,
    debug,
  };
}
