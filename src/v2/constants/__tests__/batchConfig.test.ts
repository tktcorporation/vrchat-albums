import { describe, expect, it } from 'vitest';

import { MAX_SESSION_BATCH_SIZE } from '../../../../electron/constants/batchConfig';
import { BATCH_CONFIG } from '../batchConfig';

describe('バッチ設定の SSOT', () => {
  it('フロントの送信上限は electron 側の単一ソース（tRPC 検証上限）と一致する', () => {
    // この一致が崩れると、フロントが送れる件数と tRPC が受け付ける件数が
    // 食い違い、ユーザーには成功に見えてバッチが弾かれる事故になる。
    expect(BATCH_CONFIG.MAX_SESSION_BATCH_SIZE).toBe(MAX_SESSION_BATCH_SIZE);
  });

  it('フロント専用のタイミング定数が定義されている', () => {
    expect(BATCH_CONFIG.BATCH_DELAY_MS).toBeGreaterThan(0);
    expect(BATCH_CONFIG.DUPLICATE_THRESHOLD_MS).toBeGreaterThan(0);
  });
});
