# VRChat Albums Project Structure

## Root Directory
```
/workspaces/vrchat-albums/
├── electron/           # Main process (backend)
│   ├── api.ts         # tRPC router definitions
│   ├── module/        # Business logic modules
│   │   ├── logInfo/   # Log information processing
│   │   ├── photo/     # Photo management
│   │   ├── vrchatLog/ # VRChat log parsing
│   │   └── ...        # Other modules
│   ├── valueObjects/  # Backend value objects
│   ├── lib/          # Shared utilities
│   │   └── errorHelpers.ts # Error handling utilities
│   ├── migrations/   # Database migrations
│   └── constants/    # Application constants
├── src/              # Renderer process (frontend)
│   ├── v2/           # React components v2
│   │   ├── components/
│   │   ├── hooks/
│   │   └── i18n/     # Internationalization
│   ├── components/   # Legacy components
│   ├── lib/         # Frontend utilities
│   ├── valueObjects/ # Frontend value objects
│   └── assets/      # Static assets
├── pages/           # Landing page (workspace)
├── playwright/      # E2E tests
├── scripts/        # Build and utility scripts
├── docs/           # Documentation
│   └── log-sync-architecture.md # Critical log sync docs
└── debug/          # Debug utilities (auto-generated)
```

## Key Configuration Files
- `package.json` - Dependencies and scripts
- `CLAUDE.md` - AI assistant guidelines
- `vitest.config.ts` - Test configuration
- `vitest.workspace.ts` - Workspace test config
- `electron-builder.cjs` - Electron build config
- `tailwind.config.js` - Tailwind CSS config
- `biome.json` - Biome linter config
- `tsconfig.json` - TypeScript config (root)
- `electron/tsconfig.json` - Electron TS config
- `.yarnrc.yml` - Yarn 4 configuration

## Module Organization
Each module in `/electron/module/` typically contains:
- `model.ts` - Sequelize database model
- `service.ts` - Business logic with Result types
- `service.spec.ts` - Unit tests
- `service.integration.test.ts` - Integration tests
- Additional parsers, utilities as needed

## Important Paths
- VRChat photos: `C:\\Users\\[username]\\Pictures\\VRChat`
- VRChat logs: Auto-detected by application
- Database: SQLite file managed by application
- Exports: User-specified directory

## Data Flow
1. VRChat logs parsed in `/electron/module/vrchatLog/`
2. Photos processed in `/electron/module/photo/`
3. Data stored via Sequelize models
4. tRPC API exposes to frontend via `/electron/api.ts`
5. React components in `/src/v2/` consume via tRPC hooks
6. UI updates with Tanstack Query caching