# Task Completion Process (必須)

## 🚨 CRITICAL: Must follow this exact order when completing any coding task

1. **Code Implementation** - Complete the requested changes
2. **Run `yarn lint:fix`** - Auto-fix formatting and simple issues
3. **Run `yarn lint`** - Verify all linting passes
4. **Run `yarn test`** - Ensure all tests pass
5. **Mark Task Complete** - Only after all checks pass

## Specific Lint Commands
- `yarn lint` - Runs all linters in parallel:
  - `yarn lint:biome` - Code formatting and style
  - `yarn lint:type-check` - TypeScript type checking
  - `yarn lint:actionlint` - GitHub Actions validation
  - `yarn lint:valueobjects` - ValueObject pattern validation

## Test Commands
- `yarn test` - Run all tests
- `yarn test:web` - Run web/renderer tests only
- `yarn test:electron` - Run electron/main process tests only
- `yarn test:playwright` - Run E2E tests (builds first)

## Important Notes
- **NEVER** commit unless explicitly asked by user
- If lint/typecheck commands are not found, ask user for the correct command
- Suggest writing commands to CLAUDE.md for future reference
- Tests may fail if database is not initialized properly in integration tests

## Common Issues
- ValueObject lint failures: Ensure type-only exports
- Type check failures: Check ts-pattern exhaustiveness
- Test timeouts: Check for top-level Electron imports