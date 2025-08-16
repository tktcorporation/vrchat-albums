# Code Style and Conventions

## General Guidelines
- **Package Manager**: Yarn 4 (npm is prohibited)
- **Node Version**: Node.js 20 LTS required
- **TypeScript**: All application code in TypeScript
- **Comments**: DO NOT add comments unless explicitly asked

## Import/Export Patterns
- Use ES modules (`import`/`export`)
- Avoid circular dependencies
- ValueObjects: Export types only, not classes

## Error Handling Style
- Use neverthrow Result pattern in service layer
- Always provide structured error information
- Hide technical details from user-facing messages
- Use ts-pattern for error type matching

## Testing Conventions

### Database Testing Pattern
```typescript
describe('service with database', () => {
  beforeAll(async () => {
    client.__initTestRDBClient();
  }, 10000);
  
  beforeEach(async () => {
    await client.__forceSyncRDBClient();
  });
  
  afterAll(async () => {
    await client.__cleanupTestRDBClient();
  });

  it('test case', async () => {
    // Use existing service functions for test data
    // Use datefns.parseISO for dates
  });
});
```

### Test File Organization
- Unit tests with mocks: `*.test.ts`
- Database integration tests: `*.integration.test.ts`
- Separation prevents database initialization conflicts

### Module Path Issues in Tests
- Verify relative paths carefully from test files
- Example: `electron/module/vrchatLog/` → `electron/lib/` = `../../lib/` (NOT `../../../lib/`)
- Both import paths and vi.mock() paths must be correct

## Git Conventions

### Branch Format
`{issue-number}/{type}/{summary}`

Example: `123/feat/add-user-search`

Types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`

## Auto-Generated Files (DO NOT MODIFY)
- `src/assets/licenses.json`
- `yarn.lock`
- `CHANGELOG.md`
- `debug/` directory contents

## File Structure
- `/electron/` - Main process code
- `/electron/module/` - Business logic modules
- `/electron/api.ts` - tRPC router definitions
- `/src/v2/` - React components and renderer code
- `/src/valueObjects/` - Frontend value objects
- `/electron/valueObjects/` - Backend value objects