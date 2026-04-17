/**
 * vitest 設定 (@vrchat-albums/lint-contrast パッケージ)。
 *
 * テストファイルは tests/ 配下、フィクスチャは test-fixtures/ に配置。
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
