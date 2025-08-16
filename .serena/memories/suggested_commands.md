# Suggested Commands for VRChat Albums Development

## Development Commands
- `yarn dev` - Start development server (with SENTRY_DSN disabled)
- `yarn dev:vite` - Start Vite dev server only
- `yarn dev:electron` - Build and run Electron with GPU disabled

## Build Commands
- `yarn build` - Full build (lint, type-check, vite, electron)
- `yarn build:vite` - Build frontend only
- `yarn build:electron` - Build Electron main process only
- `yarn dist` - Build and package application (no publish)
- `yarn pack` - Build and create directory package
- `yarn publish` - Build and publish to configured channel

## Quality Assurance (MUST RUN BEFORE TASK COMPLETION)
- `yarn lint:fix` - Auto-fix code style issues
- `yarn lint` - Run all linters (biome, type-check, actionlint, valueobjects)
- `yarn lint:type-check` - TypeScript type checking only
- `yarn test` - Run all tests
- `yarn test:web` - Run frontend tests only
- `yarn test:electron` - Run main process tests only
- `yarn test:playwright` - Run E2E tests

## Utility Commands
- `yarn setup:debug` - Generate debug files for development
- `yarn generate:debug-data` - Generate test data
- `yarn clean:build` - Clean build artifacts
- `yarn clean:debug` - Clean debug files
- `yarn license-check:generate` - Generate license file
- `yarn knip` - Find unused dependencies and exports

## Git Commands (Linux)
- `git status` - Check current changes
- `git diff` - View unstaged changes
- `git add .` - Stage all changes
- `git commit -m "message"` - Commit with message
- `git push` - Push to remote
- `git log --oneline -10` - View recent commits

## File System Commands (Linux)
- `ls -la` - List files with details
- `cd <path>` - Change directory
- `pwd` - Print working directory
- `cat <file>` - View file contents
- `grep -r "pattern" .` - Search recursively
- `find . -name "*.ts"` - Find files by pattern

## Package Management
- `yarn install` - Install dependencies
- `yarn add <package>` - Add new dependency
- `yarn add -D <package>` - Add dev dependency
- `yarn list` - List installed packages

## Important Notes
- Always use Yarn 4, never npm
- Run tests and linting before marking tasks complete
- Use `yarn dev` for local development
- The project requires Node.js 20 LTS