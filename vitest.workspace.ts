import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  // フロントエンド用の設定
  {
    test: {
      name: 'web',
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
      setupFiles: ['./vitest.setup.ts'],
    },
  },
  // Electron/Node.js用の設定
  {
    test: {
      name: 'electron',
      environment: 'node',
      include: ['electron/**/*.{test,spec}.{js,jsx,ts,tsx}'],
      setupFiles: ['./vitest.setup.ts'],
    },
  },
]);
