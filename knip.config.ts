import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'src/main.tsx',
    'electron/index.ts',
    'electron/preload.ts',
    'electron/api.ts',
    'electron/vite.config.ts',
    'vitest.config.ts',
    // Add tRPC controllers as entry points since they're used dynamically
    'electron/module/**/controller/*.ts',
    'electron/module/**/*Controller.ts',
  ],
  project: ['src/**/*.ts', 'src/**/*.tsx', 'electron/**/*.ts'],
  ignoreBinaries: ['only-allow'],
  ignoreDependencies: ['@types/sharp', '@antfu/ni'],
  ignore: ['src/components/ui/**'],
  // Don't report unused exports in entry files (tRPC routers)
  includeEntryExports: false,
  // Ignore exports that are used within the same file
  ignoreExportsUsedInFile: true,
};

export default config;
