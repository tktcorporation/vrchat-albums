import type { KnipConfig } from 'knip';

/**
 * Knip configuration for unused code detection
 *
 * Note: Using flat structure instead of workspaces because this is not a monorepo.
 * The workspace hints are informational and can be ignored.
 * Use `yarn knip --no-config-hints` to suppress them.
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
    // tRPC controllers are used dynamically
    'electron/module/**/controller/*.ts',
    'electron/module/**/*Controller.ts',
  ],
  // Note: vitest.config.ts is auto-detected by knip's vitest plugin
  project: ['src/**/*.{ts,tsx}', 'electron/**/*.ts'],
  ignoreBinaries: ['only-allow'],
  ignoreDependencies: [
    '@types/sharp',
    '@antfu/ni',
    // shadcn/ui indirect dependencies
    '@radix-ui/react-select',
    '@radix-ui/react-separator',
    'tw-animate-css',
  ],
  ignore: [
    'src/components/ui/**',
    // Design token types - kept for future type safety
    'src/v2/constants/ui.ts',
  ],
  // Don't report unused exports in entry files (tRPC routers)
  includeEntryExports: false,
  // Ignore exports that are used within the same file
  ignoreExportsUsedInFile: true,
};

export default config;
