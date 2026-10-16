import { buildWorldSessions, resolveSessionIndex } from '@shared/worldSession';
import { useEffect, useMemo, useRef } from 'react';

import { trpcReact } from '@/trpc';

import type { Photo } from '../../types/photo';

interface WorldInfo {
  worldId: string;
  worldName: string;
  worldInstanceId: string;
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
 * 最初のワールド参加より前に撮られた写真の割り当て先（古い順のセッション列の添字）。
 *
 * 共通の判定（`resolveSessionIndex`）はこの写真に「セッション無し」を返すが、
 * ギャラリーでは写真を非表示にせず最も近いセッションへ寄せて表示する。
 * 撮影時刻はすべての参加時刻より前なので、最も近いのは最も古いセッションになる。
 */
const NEAREST_SESSION_INDEX_BEFORE_FIRST_JOIN = 0;

/**
 * 写真をVRChatのワールドセッション単位でグループ化する
 *
 * セッションの区切りは `@shared/worldSession` の判定に従い、プレイヤー一覧・
 * プレイヤー検索と同じワールドへ写真を振り分ける。
 *
 * @param photos グループ化する写真配列
 * @param joinLogs ワールド参加ログ（通常ログと写真由来ログのマージ済み。並び順は問わない）
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

  // 古い順のセッション列（境界は共通の判定に従う）
  const sessions = buildWorldSessions(joinLogs);
  const photosBySession: Photo[][] = sessions.map(() => []);

  for (const photo of photos) {
    const index =
      resolveSessionIndex(sessions, photo.takenAt) ??
      NEAREST_SESSION_INDEX_BEFORE_FIRST_JOIN;
    photosBySession[index].push(photo);
  }

  // セッションから GroupedPhoto 形式に変換（新しい順）
  const groups: GroupedPhoto[] = sessions
    .map((session, index) => ({
      photos: photosBySession[index].toSorted(
        (a, b) => b.takenAt.getTime() - a.takenAt.getTime(),
      ),
      worldInfo: {
        worldId: session.join.worldId,
        worldName: session.join.worldName,
        worldInstanceId: session.join.worldInstanceId,
      },
      joinDateTime: session.join.joinDateTime,
    }))
    .toReversed();

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
        gcTime: 1000 * 60 * 60,
      },
    );

  // onGroupingEnd のコールバックを ref で保持（依存配列から除外するため）
  const onGroupingEndRef = useRef(onGroupingEnd);
  onGroupingEndRef.current = onGroupingEnd;

  // onGroupingEnd を一度だけ呼び出すためのフラグ
  const hasCalledOnGroupingEndRef = useRef(false);

  const groupedPhotos = useMemo(() => {
    if (isLoadingLogs || !joinLogs) {
      return {};
    }
    if (joinLogs.length === 0) {
      return {};
    }

    const groups = groupPhotosBySession(photos, joinLogs);
    const result = convertGroupsToRecord(groups);

    return result;
  }, [photos, joinLogs, isLoadingLogs]);

  // グルーピング完了時のコールバックを useEffect で実行（useMemo 内の副作用を排除）
  // 一度だけ呼び出す（再レンダリングによる無限ループを防止）
  useEffect(() => {
    const groupCount = Object.keys(groupedPhotos).length;
    if (groupCount > 0 && !hasCalledOnGroupingEndRef.current) {
      hasCalledOnGroupingEndRef.current = true;
      onGroupingEndRef.current?.();
    }
  }, [groupedPhotos]);

  // デバッグ情報をメモ化
  const debug = useMemo<DebugInfo>(() => {
    const baseDebug: DebugInfo = {
      totalPhotos: photos.length,
      totalGroups: Object.keys(groupedPhotos).length,
    };

    // セッション情報を追加
    if (joinLogs) {
      const sessions = buildWorldSessions(joinLogs);
      const openSessions = sessions.filter(
        (s) => s.nextJoinDateTime === undefined,
      ).length;
      baseDebug.sessionInfo = {
        totalSessions: sessions.length,
        openSessions,
        closedSessions: sessions.length - openSessions,
      };
    }

    return baseDebug;
  }, [photos.length, groupedPhotos, joinLogs]);

  // 返り値オブジェクトをメモ化して、参照の安定性を確保
  return useMemo(
    () => ({
      groupedPhotos,
      isLoading: isLoadingLogs,
      debug,
    }),
    [groupedPhotos, isLoadingLogs, debug],
  );
}
