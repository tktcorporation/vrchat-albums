import {
  LAYOUT_CONSTANTS,
  type LayoutConstants,
} from '../constants/layoutConstants';
import type { Photo } from '../types/photo';

/**
 * レイアウト計算用の中間的な写真データ型
 *
 * Photo（PhotoMetadataOnly | PhotoFullyLoaded）に表示用のサイズ情報を追加。
 * intersection type を使用して union 型を正しく拡張。
 */
export type LayoutPhoto = Photo & {
  displayWidth: number;
  displayHeight: number;
};

/** レイアウト計算結果の型 */
export interface LayoutResult {
  /** 行ごとに分けられた写真配列 */
  rows: LayoutPhoto[][];
  /** 総高さ（ヘッダー、スペース、グリッドを含む） */
  totalHeight: number;
  /** グリッド部分のみの高さ */
  gridHeight: number;
}

/**
 * Justified Layout アルゴリズムの統一実装クラス
 *
 * PhotoGrid と GalleryContent で同じレイアウト計算ロジックを共有し、
 * データ整合性を保証する。Google Photos 風の行ベースレイアウトを実装。
 *
 * ## 主要機能
 * - 写真を行に分配し、各行の幅を親要素にフィット
 * - アスペクト比を保持したスケーリング
 * - 最後の行の適切な処理（1枚の場合は制限、複数枚は適度にスケール）
 * - バーチャルスクロール用の高さ予測
 *
 * ## 使用例
 * ```typescript
 * const calculator = new JustifiedLayoutCalculator();
 * const result = calculator.calculateLayout(photos, containerWidth);
 * const height = calculator.calculateTotalHeight(photos, containerWidth);
 * ```
 *
 * @see docs/date-jump-architecture.md - 日付ジャンプ機能の設計
 * @see PhotoGrid
 * @see GalleryContent
 */
export class JustifiedLayoutCalculator {
  private readonly constants: LayoutConstants;

  constructor(constants: LayoutConstants = LAYOUT_CONSTANTS) {
    this.constants = constants;
  }

  /**
   * 完全なレイアウト計算を実行
   * PhotoGrid でのレンダリングに使用される
   */
  calculateLayout(photos: Photo[], containerWidth: number): LayoutResult {
    // Note: containerWidth > 0 は ValidWidth 型によりコンポーネント層で保証される
    const rows: LayoutPhoto[][] = [];
    let currentRow: LayoutPhoto[] = [];
    let rowWidth = 0;

    // 写真をレイアウト用に変換
    const layoutPhotos: LayoutPhoto[] = photos.map((photo) => ({
      ...photo,
      width: photo.width || 1920,
      height: photo.height || 1080,
      displayWidth: 0,
      displayHeight: 0,
    }));

    // 写真を行に分配
    for (const photo of layoutPhotos) {
      const aspectRatio = photo.width / photo.height;
      const photoWidth = this.constants.TARGET_ROW_HEIGHT * aspectRatio;

      // 現在の行に追加した場合の合計幅（ギャップを含む）
      const totalWidthWithPhoto =
        currentRow.length > 0
          ? rowWidth + photoWidth + this.constants.GAP
          : photoWidth;

      if (totalWidthWithPhoto > containerWidth && currentRow.length > 0) {
        // 現在の行を確定（行幅を親要素にぴったり合わせる）
        this.finalizeRow(currentRow, containerWidth, rowWidth);
        rows.push(currentRow);
        currentRow = [];
        rowWidth = 0;
      }

      currentRow.push({
        ...photo,
        displayWidth: photoWidth,
        displayHeight: this.constants.TARGET_ROW_HEIGHT,
      });
      rowWidth += photoWidth + (currentRow.length > 1 ? this.constants.GAP : 0);
    }

    // 最後の行を処理
    if (currentRow.length > 0) {
      this.finalizeLastRow(currentRow, containerWidth, rowWidth);
      rows.push(currentRow);
    }

    const gridHeight = this.calculateGridHeightFromRows(rows);
    const totalHeight =
      this.constants.HEADER_HEIGHT + this.constants.SPACING + gridHeight;

    return { rows, totalHeight, gridHeight };
  }

  /**
   * 総高さのみを計算（バーチャルスクロール用の軽量版）
   * GalleryContent での高さ予測に使用される
   */
  calculateTotalHeight(photos: Photo[], containerWidth: number): number {
    // Note: containerWidth > 0 は ValidWidth 型によりコンポーネント層で保証される
    let totalHeight = this.constants.HEADER_HEIGHT + this.constants.SPACING;

    // 写真がない場合は固定の高さを返す
    if (photos.length === 0) {
      return totalHeight;
    }

    let currentRowWidth = 0;
    let currentRowPhotos = 0;

    for (const photo of photos) {
      const aspectRatio = (photo.width || 1920) / (photo.height || 1080);
      const photoWidth = this.constants.TARGET_ROW_HEIGHT * aspectRatio;

      if (
        currentRowWidth + photoWidth + this.constants.GAP > containerWidth &&
        currentRowPhotos > 0
      ) {
        // 行の高さを計算して追加
        const scale =
          (containerWidth - (currentRowPhotos - 1) * this.constants.GAP) /
          currentRowWidth;
        totalHeight +=
          this.constants.TARGET_ROW_HEIGHT * scale + this.constants.GAP;
        currentRowWidth = 0;
        currentRowPhotos = 0;
      }

      currentRowWidth += photoWidth + this.constants.GAP;
      currentRowPhotos++;
    }

    // 最後の行を処理
    if (currentRowPhotos > 0) {
      if (currentRowPhotos === 1) {
        totalHeight += this.constants.TARGET_ROW_HEIGHT + this.constants.GAP;
      } else {
        const scale =
          (containerWidth - (currentRowPhotos - 1) * this.constants.GAP) /
          currentRowWidth;
        totalHeight +=
          this.constants.TARGET_ROW_HEIGHT * scale + this.constants.GAP;
      }
    }

    return Math.ceil(totalHeight);
  }

  /**
   * 通常の行を確定（行幅を親要素にフィット）
   */
  private finalizeRow(
    row: LayoutPhoto[],
    containerWidth: number,
    rowWidth: number,
  ): void {
    const totalGaps = (row.length - 1) * this.constants.GAP;
    const availableWidth = containerWidth - totalGaps;
    const scale = availableWidth / (rowWidth - row.length * this.constants.GAP);

    for (const photo of row) {
      photo.displayHeight = this.constants.TARGET_ROW_HEIGHT * scale;
      photo.displayWidth = photo.displayHeight * (photo.width / photo.height);
    }
  }

  /**
   * 最後の行を処理（1枚の場合は制限、複数枚は適度にスケール）
   */
  private finalizeLastRow(
    row: LayoutPhoto[],
    containerWidth: number,
    rowWidth: number,
  ): void {
    if (row.length === 1) {
      // 1枚だけの場合は幅を制限しつつ中央寄せを考慮
      const photo = row[0];
      const aspectRatio = photo.width / photo.height;
      const maxWidth = Math.min(
        this.constants.TARGET_ROW_HEIGHT * aspectRatio,
        containerWidth,
      );
      photo.displayHeight = Math.min(
        this.constants.TARGET_ROW_HEIGHT,
        maxWidth / aspectRatio,
      );
      photo.displayWidth = photo.displayHeight * aspectRatio;
    } else {
      // 複数枚の場合は他の行と同様に幅をフィット
      const totalGaps = (row.length - 1) * this.constants.GAP;
      const availableWidth = containerWidth - totalGaps;
      const currentTotalWidth = rowWidth - row.length * this.constants.GAP;

      // 最後の行が短すぎる場合は最大1.5倍までスケールアップ
      const maxScale = Math.min(
        availableWidth / currentTotalWidth,
        this.constants.MAX_LAST_ROW_SCALE,
      );
      const scale = maxScale;

      for (const photo of row) {
        photo.displayHeight = this.constants.TARGET_ROW_HEIGHT * scale;
        photo.displayWidth = photo.displayHeight * (photo.width / photo.height);
      }
    }
  }

  /**
   * 行配列からグリッドの総高さを計算
   */
  private calculateGridHeightFromRows(rows: LayoutPhoto[][]): number {
    if (rows.length === 0) return 0;

    let height = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.length > 0) {
        height += row[0].displayHeight;
        if (i < rows.length - 1) {
          // 最後の行以外はギャップを追加
          height += this.constants.GAP;
        }
      }
    }
    return height;
  }
}
