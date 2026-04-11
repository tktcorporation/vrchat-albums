import type { KnipConfig } from 'knip';

/**
 * Knip configuration for unused code detection
 *
 * Note: Using flat structure instead of workspaces because src/ and electron/
 * are tightly coupled via tRPC. Workspaces would break cross-directory imports.
 */
const config: KnipConfig = {
  entry: [
    // Renderer process
    'src/main.tsx',
    // Main process
    'electron/index.ts',
    'electron/preload.ts',
    'electron/api.ts',
    'electron/vite.config.ts',
    'electron/vite.config.preload.ts',
    // tRPC controllers are used dynamically
    'electron/module/**/*Controller.ts',
  ],
  project: ['src/**/*.{ts,tsx}', 'electron/**/*.ts'],
  ignoreBinaries: [
    'only-allow',
    // grit binary comes from @getgrit/cli package
    'grit',
    // napi-rs CLI — CI で npx -p @napi-rs/cli napi build として使用
    'napi',
  ],
  ignoreDependencies: [
    '@antfu/ni',
    // CSS-only import in src/index.css (not detected by knip)
    'tw-animate-css',
    // Used in scripts/ which is ignored by knip
    'minimatch',
    // electron-builder の optional peer dependency（直接 import されないが macOS/Windows ビルドに必要）
    'electron-builder-squirrel-windows',
  ],
  ignore: [
    // shadcn/ui components
    'src/components/ui/**',
    // Design token types - kept for future type safety
    'src/v2/constants/ui.ts',
    // Lint scripts and test fixtures
    'scripts/**',
    // GritQL patterns and modules
    '.grit/**',
    // napi-rs 生成コード（index.js/index.d.ts）は knip のスコープ外
    'packages/exif-native/**',
  ],
  // Don't report unused exports in entry files (tRPC routers)
  includeEntryExports: false,
  // Ignore exports that are used within the same file
  ignoreExportsUsedInFile: true,
};

export default config;
