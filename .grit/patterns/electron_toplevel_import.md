# Electron Top-level Import Check

Detects top-level imports of Electron modules (app, BrowserWindow, dialog, shell, etc.).

These imports cause Playwright tests to crash because Electron is not available in the test environment.

## Allowed files
- `index.ts` - Main process entry point
- `preload.ts` - Preload script

## Recommended pattern

Use lazy evaluation instead:

```typescript
// ✅ OK: Lazy evaluation
const getLogPath = () => {
  try {
    const { app } = require('electron');
    return app.getPath('logs');
  } catch {
    return '/tmp/test-logs';
  }
};
```

## Pattern

```grit
language js

// Detect top-level electron imports with runtime APIs
// Type-only imports (like `import type { Rectangle }`) are safe
`import { $imports } from 'electron'` where {
  $imports <: contains or {
    `app`,
    `BrowserWindow`,
    `dialog`,
    `shell`,
    `clipboard`,
    `nativeImage`,
    `ipcMain`,
    `ipcRenderer`
  }
}
```
