import { err, ok, type Result } from 'neverthrow';
import { PhotoPickupModel } from './model';

type PhotoPickupError = { type: 'NOT_FOUND'; photoId: string };

/**
 * 写真をピックアップに追加する。
 * 既に追加済みの場合は既存レコードをそのまま返す（冪等）。
 */
export const addPickup = async (
  photoId: string,
): Promise<Result<PhotoPickupModel, never>> => {
  const existing = await PhotoPickupModel.findOne({ where: { photoId } });
  if (existing) {
    return ok(existing);
  }
  const created = await PhotoPickupModel.create({ photoId });
  return ok(created);
};

/**
 * 写真をピックアップから削除する。
 * 対象が存在しない場合は NOT_FOUND エラーを返す。
 */
export const removePickup = async (
  photoId: string,
): Promise<Result<void, PhotoPickupError>> => {
  const deleted = await PhotoPickupModel.destroy({ where: { photoId } });
  if (deleted === 0) {
    return err({ type: 'NOT_FOUND', photoId });
  }
  return ok(undefined);
};

/**
 * ピックアップを全件削除する。
 * 削除した件数を返す。
 */
export const removeAllPickups = async (): Promise<Result<number, never>> => {
  const deleted = await PhotoPickupModel.destroy({ where: {} });
  return ok(deleted);
};

/**
 * ピックアップ一覧を追加日時の降順で取得する。
 */
export const listPickups = async (): Promise<
  Result<PhotoPickupModel[], never>
> => {
  const pickups = await PhotoPickupModel.findAll({
    order: [['createdAt', 'DESC']],
  });
  return ok(pickups);
};

/**
 * ピックアップ済み photoId の Set を返す。
 * フロントエンドで「ピック済みかどうか」を O(1) で判定するために使用。
 */
export const getPickupPhotoIdSet = async (): Promise<
  Result<Set<string>, never>
> => {
  const pickups = await PhotoPickupModel.findAll({
    attributes: ['photoId'],
    raw: true,
  });
  return ok(new Set(pickups.map((p) => p.photoId)));
};
