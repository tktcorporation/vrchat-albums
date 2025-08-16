# Architecture and Design Patterns

## High-Level Architecture
- **Main Process**: `/electron/` - Contains tRPC router (api.ts) and business logic (/module/)
- **Renderer Process**: `/src/v2/` - React components, hooks, i18n
- **Communication**: All IPC through tRPC routers defined in `electron/api.ts`

## Critical Architectural Patterns

### 1. Log Synchronization (データ整合性必須)
**CRITICAL**: Must follow strict execution order to prevent photo misclassification
- **Order**: `appendLoglines` → `loadLogInfo` → cache invalidation
- **Frontend**: Use `useLogSync` hook
- **Backend**: Use `syncLogs()` service
- **Never call append/load functions individually**
- **Reference**: `docs/log-sync-architecture.md`

### 2. Error Handling (3-Layer Architecture)
- **Service Layer**: neverthrow Result pattern (`Result<T, E>`)
- **tRPC Layer**: UserFacingError with structured info
- **Frontend Layer**: parseErrorFromTRPC + Toast variant selection

Structured Error Info:
```typescript
interface StructuredErrorInfo {
  code: string;           // 'FILE_NOT_FOUND', 'DATABASE_ERROR', etc.
  category: string;       // ERROR_CATEGORIES enum値
  userMessage: string;    // ユーザー向けメッセージ
}
```

Error mapping with ts-pattern in `electron/lib/errorHelpers.ts`
ALL mappings MUST have `default` case to prevent "予期しないエラー"

### 3. Timezone Handling (日時データ整合性必須)
- All datetime data processed as local time consistently
- Log parsing: `parseLogDateTime()` interprets VRChat logs as local time
- Frontend dates: `new Date('YYYY-MM-DDTHH:mm:ss')` for local time
- Database: Sequelize automatically stores Date objects in UTC
- Critical rule: Always implement in local time base, let Sequelize/JS handle UTC conversion

### 4. Conditional Logic with ts-pattern
**Mandatory**: Replace ALL `if` statements with `match()` from ts-pattern for:
- Error handling conditionals
- Enum/string literal comparisons
- Type guards and instanceof checks
- Nested if-else chains

Exceptions (no ts-pattern needed):
- Simple boolean checks
- Complex business logic conditions
- Test assertions

### 5. ValueObject Pattern
- Type-only export pattern for ValueObject classes
- Instance creation only through Zod schemas
- Validation functions as independent functions
- Enforced by `yarn lint:valueobjects`

### 6. Database Access
- Sequelize models in `/electron/module/*/model.ts`
- Services wrap DB operations with Result types
- DB queue system prevents concurrent write issues

### 7. Photo Processing
- EXIF data extraction using exiftool-vendored
- Image processing with sharp for thumbnails
- Automatic association with VRChat log files based on timestamps

### 8. Module Import Pattern (Playwright compatibility)
- **Never** import Electron modules (`app`, `BrowserWindow`) at top level
- Use lazy evaluation or dynamic imports
- Critical for common modules like `logger.ts`
- Prevents Playwright test timeout errors