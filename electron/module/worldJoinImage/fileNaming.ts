import * as datefns from 'date-fns';
import * as path from 'pathe';

/**
 * World Join 画像のファイル名を生成する
 *
 * 背景: vrchat-join-recorder の命名規則に準拠。
 * VRChat_ プレフィックスにより既存の写真スキャンに自然に統合される。
 * ローカルタイムを使用（timezone.md ルール準拠）。
 *
 * 呼び出し元: worldJoinImage サービス（画像保存時）
 * 対になる関数: isWorldJoinImageFile()（スキャン時の判定）
 */
export const generateWorldJoinImageFileName = (
  joinDateTime: Date,
  worldId: string,
): string => {
  const dateStr = datefns.format(joinDateTime, 'yyyy-MM-dd_HH-mm-ss.SSS');
  return `VRChat_${dateStr}_${worldId}.jpeg`;
};

/**
 * World Join 画像のフルパスを生成する
 *
 * YYYY-MM サブディレクトリに配置することで、VRChat 標準の写真ディレクトリ構造に合わせる。
 */
export const generateWorldJoinImagePath = (
  photoDirPath: string,
  joinDateTime: Date,
  worldId: string,
): string => {
  const yearMonth = datefns.format(joinDateTime, 'yyyy-MM');
  const fileName = generateWorldJoinImageFileName(joinDateTime, worldId);
  return path.join(photoDirPath, yearMonth, fileName);
};

/**
 * ファイル名が World Join 画像かどうかを判定する
 *
 * 背景: 写真スキャン時に通常の VRChat 写真と World Join 画像を区別するために使用。
 * VRChat_ プレフィックス + _wrld_ を含む + .jpeg 拡張子の組み合わせで判定。
 */
export const isWorldJoinImageFile = (filename: string): boolean => {
  return (
    filename.startsWith('VRChat_') &&
    filename.endsWith('.jpeg') &&
    filename.includes('_wrld_')
  );
};
