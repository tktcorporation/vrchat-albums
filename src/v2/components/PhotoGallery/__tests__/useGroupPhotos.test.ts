import { describe, expect, it } from 'vitest';
import { VRChatPhotoFileNameWithExtSchema } from '../../../../valueObjects';
import type { Photo } from '../../../types/photo';
import type { WorldJoinLog } from '../useGroupPhotos';
import { groupPhotosBySession } from '../useGroupPhotos';

// モックデータの作成ヘルパー
/**
 * 指定日時の写真オブジェクトを生成するテスト用関数。
 * groupPhotosBySession の検証で写真一覧を作る際に使用する。
 */
const createPhoto = (id: string | number, takenAt: Date): Photo => ({
  id: id.toString(),
  url: `photo-${id}`,
  // /^VRChat_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}_\d+x\d+\.[a-z]+$/
  fileNameWithExt: VRChatPhotoFileNameWithExtSchema.parse(
    'VRChat_2025-05-25_12-00-00.000_1920x1080.png',
  ),
  width: 1920,
  height: 1080,
  takenAt,
  location: {
    joinedAt: takenAt,
  },
});

/**
 * ワールド参加ログのモックを生成するヘルパー。
 * 参加日時やワールド名を指定してテストデータを作成する。
 */
const createWorldJoinLog = (
  id: string | number,
  joinDateTime: Date,
  worldName = `World ${id}`,
): WorldJoinLog => ({
  worldId: id.toString(),
  worldName,
  worldInstanceId: `instance${id}`,
  joinDateTime,
});

describe('groupPhotosBySession', () => {
  it('新しい写真から順にグループ化される', () => {
    const now = new Date();
    const photos = [
      createPhoto('1', new Date(now.getTime() - 1000)), // 1秒前
      createPhoto('2', new Date(now.getTime() - 2000)), // 2秒前
      createPhoto('3', new Date(now.getTime() - 3000)), // 3秒前
    ];

    const joinLogs = [
      createWorldJoinLog('world1', new Date(now.getTime() - 2500)), // 2.5秒前
      createWorldJoinLog('world2', new Date(now.getTime() - 4000)), // 4秒前
    ];

    const groups = groupPhotosBySession(photos, joinLogs);

    expect(groups).toHaveLength(2); // 2つのワールドグループができているはず

    // 最初のグループ（新しい方）の検証
    expect(groups[0].photos).toHaveLength(2); // photo1とphoto2
    expect(groups[0].photos[0].id).toBe('1'); // 最新の写真が最初
    expect(groups[0].photos[1].id).toBe('2');
    expect(groups[0].worldInfo?.worldId).toBe('world1');

    // 2番目のグループの検証
    expect(groups[1].photos).toHaveLength(1); // photo3
    expect(groups[1].photos[0].id).toBe('3');
    expect(groups[1].worldInfo?.worldId).toBe('world2');
  });

  it('写真がない場合は空の配列を返す', () => {
    const groups = groupPhotosBySession([], []);
    expect(groups).toHaveLength(0);
  });

  it('写真がないがjoinLogがある場合、空の写真でセッションを表示', () => {
    const now = new Date();
    const joinLogs = [
      createWorldJoinLog('world1', new Date(now.getTime() - 1000)),
      createWorldJoinLog('world2', new Date(now.getTime() - 2000)),
    ];

    const groups = groupPhotosBySession([], joinLogs);

    expect(groups).toHaveLength(2);
    expect(groups[0].photos).toHaveLength(0);
    expect(groups[0].worldInfo?.worldId).toBe('world1');
    expect(groups[1].photos).toHaveLength(0);
    expect(groups[1].worldInfo?.worldId).toBe('world2');
  });

  it('同じワールドの複数セッションを正しく処理', () => {
    const now = new Date();
    const photos = [
      createPhoto('1', new Date(now.getTime() - 1000)), // 1秒前
      createPhoto('2', new Date(now.getTime() - 3000)), // 3秒前
      createPhoto('3', new Date(now.getTime() - 5000)), // 5秒前
    ];

    const joinLogs = [
      createWorldJoinLog('world1', new Date(now.getTime() - 2000)), // 2秒前
      createWorldJoinLog('world1', new Date(now.getTime() - 4000)), // 4秒前
    ];

    const groups = groupPhotosBySession(photos, joinLogs);

    expect(groups).toHaveLength(2); // 同じワールドでも別セッションとして2つのグループができる
    expect(groups[0].photos).toHaveLength(1); // 最新のセッション（1秒前の写真）
    expect(groups[0].photos[0].id).toBe('1');
    expect(groups[1].photos).toHaveLength(2); // 古いセッション（3秒前と5秒前の写真）
    expect(groups[1].photos.map((p) => p.id).sort()).toEqual(['2', '3']);
  });

  it('写真とセッションの時間が完全に一致する場合', () => {
    const now = new Date();
    const photos = [createPhoto('1', new Date(now.getTime()))];

    const joinLogs = [createWorldJoinLog('world1', new Date(now.getTime()))];

    const groups = groupPhotosBySession(photos, joinLogs);

    expect(groups).toHaveLength(1);
    expect(groups[0].photos).toHaveLength(1);
    expect(groups[0].photos[0].id).toBe('1');
  });

  it('セッションログがない場合、最も近いセッションに割り当てられる', () => {
    const baseTime = new Date('2024-01-01T12:00:00Z').getTime();

    // セッション1: 12:10:00 - 12:20:00
    const session1Start = new Date(baseTime + 10 * 60 * 1000); // 12:10:00
    const session1Photos = [
      createPhoto(1, new Date(baseTime + 15 * 60 * 1000)), // 12:15:00
      createPhoto(2, new Date(baseTime + 18 * 60 * 1000)), // 12:18:00
    ];

    // セッション2: 12:00:00 - 12:10:00
    const session2Start = new Date(baseTime); // 12:00:00
    const session2Photos = [
      createPhoto(3, new Date(baseTime + 5 * 60 * 1000)), // 12:05:00
      createPhoto(4, new Date(baseTime + 8 * 60 * 1000)), // 12:08:00
    ];

    const photos = [...session1Photos, ...session2Photos];
    const joinLogs = [
      createWorldJoinLog('1', session1Start, 'World1'),
      createWorldJoinLog('2', session2Start, 'World2'),
    ];

    const groups = groupPhotosBySession(photos, joinLogs);

    expect(groups).toHaveLength(2);
    expect(groups[0].photos.map((p) => p.id).sort()).toEqual(['1', '2']); // 最新のセッションに2枚
    expect(groups[1].photos.map((p) => p.id).sort()).toEqual(['3', '4']); // 古いセッションに2枚
  });

  it('大量の写真を正しく処理できる', () => {
    const now = new Date();
    const photos = Array.from({ length: 100 }, (_, i) =>
      createPhoto(i, new Date(now.getTime() - i * 1000)),
    );

    const joinLogs = Array.from({ length: 10 }, (_, i) =>
      createWorldJoinLog(i, new Date(now.getTime() - i * 10000)),
    );

    const groups = groupPhotosBySession(photos, joinLogs);

    const totalPhotos = groups.reduce(
      (sum, group) => sum + group.photos.length,
      0,
    );
    expect(totalPhotos).toBe(photos.length);
  });
});
