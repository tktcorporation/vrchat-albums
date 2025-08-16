# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## High-Level Architecture

Electron desktop app for organizing VRChat photos by automatically associating them with log files.

**Tech Stack**: Electron + React 18 + TypeScript + Vite + tRPC + SQLite/Sequelize + Tailwind/Radix UI + ts-pattern

**Structure**:
- `/electron/` - Main process (tRPC router in api.ts, business logic in /module/)
- `/src/v2/` - Renderer process (React components, hooks, i18n)

## ⚠️ CRITICAL GUIDELINES

### 🚨 Log Synchronization (データ整合性必須)
**Execution Order**: `appendLoglines` → `loadLogInfo` → cache invalidation
**違反すると写真が間違ったワールドに分類されます**

- ✅ Use: `useLogSync` hook (frontend) / `syncLogs()` service (backend)
- ❌ Never: Call append/load functions individually
- 📖 Reference: `docs/log-sync-architecture.md`

### 🚨 Task Completion Process
```
1. Code Implementation
2. yarn lint:fix
3. yarn lint
4. yarn test
5. Task Completion
```

### Key Architectural Patterns

1. **tRPC Communication**: All communication between Electron main and renderer processes goes through tRPC routers defined in `electron/api.ts`

2. **Error Handling** (型安全・構造化システム): 
   - **3層エラーアーキテクチャ**:
     - Service層: neverthrow Result pattern (`Result<T, E>`)
     - tRPC層: UserFacingError with structured info (`code`/`category`/`userMessage`)
     - Frontend層: parseErrorFromTRPC + Toast variant selection
   - **構造化エラー情報**:
     ```typescript
     interface StructuredErrorInfo {
       code: string;           // 'FILE_NOT_FOUND', 'DATABASE_ERROR', etc.
       category: string;       // ERROR_CATEGORIES enum値
       userMessage: string;    // ユーザー向けメッセージ
     }
     ```
   - **エラーマッピング with ts-pattern**: 
     - `electron/lib/errorHelpers.ts`: Result→UserFacingError bridging
     - ALL mappings MUST have `default` case (prevent "予期しないエラー")
     - Type-safe error handling with `match()` from ts-pattern
   - **Frontend Error Processing**:
     - `parseErrorFromTRPC()`: Extract structured error info from tRPC responses
     - Toast variant mapping: `getToastVariant(category)` with ts-pattern
     - Categories: `FILE_NOT_FOUND`→warning, `DATABASE_ERROR`→destructive, etc.
   - **Technical Detail Hiding**:
     - UserFacingError: Hide stack traces from user-facing messages
     - tRPC errorFormatter: Include debug info only for non-UserFacingErrors
     - Frontend: Show only `userMessage`, not technical details
   - **Error Category → Toast Variant Mapping**:
     ```typescript
     // src/v2/App.tsx getToastVariant()
     FILE_NOT_FOUND → 'warning'        // 準正常系
     VALIDATION_ERROR → 'warning'      // ユーザー入力問題
     SETUP_REQUIRED → 'default'        // 初期設定
     PERMISSION_DENIED → 'destructive' // システムエラー
     DATABASE_ERROR → 'destructive'    // 重大エラー
     NETWORK_ERROR → 'destructive'     // 重大エラー
     ```

3. **Database Access**: 
   - Sequelize models in `/electron/module/*/model.ts` files
   - Services wrap DB operations with Result types for error handling
   - DB queue system prevents concurrent write issues

4. **Photo Processing**:
   - EXIF data extraction using exiftool-vendored
   - Image processing with sharp for thumbnails
   - Automatic association with VRChat log files based on timestamps

5. **🚨 Log Synchronization Architecture** (CRITICAL - データ整合性必須):
   - **Execution Order**: `appendLoglines` → `loadLogInfo` → cache invalidation (厳守必須)
   - **Data Corruption Risk**: 順序違反で写真が間違ったワールドに分類される
   - **Sync Modes**: 
     - `FULL`: Complete processing (初回起動、設定更新時)
     - `INCREMENTAL`: Delta processing (通常更新、バックグラウンド)
   - **Unified Pattern**: `useLogSync` hook (frontend) / `syncLogs` service (backend)
   - **Initial Launch Detection**: 既存ログ件数によるDB状態判定
   - **Cache Strategy**: startup detection (staleTime: 0) vs regular data (5min)
   - **Reference**: `docs/log-sync-architecture.md` (詳細実装パターン)

6. **🚨 Timezone Handling Architecture** (CRITICAL - 日時データ整合性必須):
   - **Consistent Local Time Processing**: 全ての日時データをローカルタイムとして統一処理
   - **Log Parsing**: `parseLogDateTime()` でVRChatログをローカルタイムとして解釈
   - **Frontend Dates**: フロントエンド日付入力は `new Date('YYYY-MM-DDTHH:mm:ss')` でローカルタイム処理
   - **Database Storage**: SequelizeがDateオブジェクトを自動的にUTCで保存
   - **UTC Conversion**: JavaScript Dateオブジェクトがローカルタイム→UTC変換を自動実行
   - **Photo Timestamps**: 写真ファイル名の日時もローカルタイムとして処理
   - **Test Pattern**: `electron/module/vrchatLog/parsers/timezone.test.ts` に統一パターン
   - **Critical Rule**: 日時処理では常にローカルタイムベースで実装、UTC変換はSequelize/JSに委ねる

7. **🚨 Conditional Logic with ts-pattern** (型安全・表現力向上必須):
   - **Mandatory Usage**: Replace ALL `if` statements with `match()` from ts-pattern
   - **Priority Targets**:
     - Error handling conditionals (`instanceof Error`, error code comparison)
     - Enum/string literal comparisons (`match(status).with('pending', ...)`)
     - Type guards and `instanceof` checks (`match(obj).with(P.instanceOf(Error), ...)`)
     - Nested if-else chains
   - **Required Pattern**:
     ```typescript
     import { match, P } from 'ts-pattern';
     
     // Replace: if (error instanceof Error) return handleError(error);
     return match(error)
       .with(P.instanceOf(Error), (err) => handleError(err))
       .otherwise((err) => { throw err; });
     ```
   - **Exceptions (NO ts-pattern needed)**:
     - Simple boolean checks (`if (isLoading)`)
     - Complex business logic conditions
     - Test assertions
   - **Benefits**: Type inference, exhaustiveness checking, better readability


### Auto-Generated Files (変更禁止)
- `src/assets/licenses.json`
- `yarn.lock`
- `CHANGELOG.md`
- `debug/` directory

### Git Branch Format
`{issue-number}/{type}/{summary}`
Example: `123/feat/add-user-search`

Types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`

## Environment Requirements
- Node.js 20 LTS
- Yarn 4 (npm禁止)

## Database Testing Pattern

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

Reference: `electron/module/logInfo/service.spec.ts`

## Test Organization Patterns

### Integration Test Separation
- Unit tests with mocks: `*.test.ts`
- Database integration tests: `*.integration.test.ts`
- Separating integration tests prevents database initialization conflicts in test runners

Example: `logInfoController.test.ts` (mocked) vs `logInfoController.integration.test.ts` (real DB)

### Vitest Mock Issues
- Electron app mocking may require `vi.mock('electron')` before other mocks
- Complex file system mocks may fail; use `describe.skip()` for problematic tests
- Dynamic imports don't always solve mock timing issues in vitest

### 🚨 Module Path Issues in Tests
- **相対パスの確認必須**: テストファイルからのモジュールパスを正確に計算
- **Example**: `electron/module/vrchatLog/` → `electron/lib/` = `../../lib/` (NOT `../../../lib/`)
- **症状**: `TypeError: The "path" argument must be of type string. Received undefined`
- **原因**: モックされた関数が `undefined` を返す（パスが間違っているため）
- **解決**: import パスと vi.mock() パスの両方を修正

### 🚨 ValueObject Pattern (型安全・カプセル化必須)
- **Type-Only Export Pattern**: ValueObjectクラスは型のみエクスポート
  ```typescript
  class MyValueObject extends BaseValueObject<'MyValueObject', string> {}
  export type { MyValueObject };  // ✅ 型のみエクスポート
  export { MyValueObject };        // ❌ クラスエクスポート禁止
  ```
- **Instance Creation**: Zodスキーマ経由でのみインスタンス化
  ```typescript
  const obj = MyValueObjectSchema.parse(value);  // ✅
  const obj = new MyValueObject(value);          // ❌ 直接new禁止
  ```
- **Validation Functions**: 静的メソッドは独立関数として定義
  ```typescript
  export const isValidMyValueObject = (value: string): boolean => {...}
  ```
- **Lint Enforcement**: `yarn lint:valueobjects` で自動検証
- **Benefits**: カプセル化強化、不正なインスタンス生成防止

### 🚨 Electron Module Import Pattern (CRITICAL - Playwright テスト互換性必須)
- **トップレベル import 禁止**: `electron` の `app`, `BrowserWindow` 等をトップレベルでインポートしない
  ```typescript
  // ❌ NEVER: Playwright テストでクラッシュ
  import { app } from 'electron';
  const logPath = app.getPath('logs');
  
  // ✅ OK: 遅延評価または動的インポート
  const getLogPath = () => {
    try {
      const { app } = require('electron');
      return app.getPath('logs');
    } catch {
      return '/tmp/test-logs';
    }
  };
  ```
- **共通モジュールは特に注意**: `logger.ts` など多くのモジュールから使用される共通モジュールでトップレベルインポートすると、依存する全モジュールが影響を受ける
- **動的インポートの落とし穴**: `await import()` を使っても、インポート先がトップレベルで Electron を使用していれば同じ問題が発生
- **症状**: Playwright テストで `electronApplication.firstWindow: Timeout` エラー
- **Reference**: `docs/troubleshooting-migration-playwright-timeout.md`

## MCP Server Usage Guidelines

### 1. IDE MCP Server (`mcp__ide__`)
VS Code統合機能を提供。エディタの診断情報取得やコード実行に使用。
- `getDiagnostics`: TypeScriptエラーや警告を取得
- `executeCode`: Jupyter notebookでのPythonコード実行

### 2. Context7 MCP Server (`mcp__context7__`)
最新のライブラリドキュメント取得用。
- **使用手順**:
  1. `resolve-library-id`: ライブラリ名からContext7互換IDを取得
  2. `get-library-docs`: IDを使用してドキュメントを取得
- **対応ライブラリ**: React, Next.js, Supabase, MongoDB等の主要ライブラリ

### 3. Serena MCP Server (`mcp__serena__`)
セマンティックコード解析とシンボルベースの編集。
- **主要機能**:
  - `find_symbol`: 名前パスによるシンボル検索
  - `replace_symbol_body`: シンボル全体の置換
  - `insert_before_symbol`/`insert_after_symbol`: シンボル前後への挿入
  - `find_referencing_symbols`: シンボルの参照箇所検索
  - `get_symbols_overview`: ファイル内シンボルの概要取得
- **メモリ管理**:
  - `write_memory`: プロジェクト情報の保存
  - `read_memory`: 保存情報の読み取り
  - `onboarding`: 初回プロジェクト分析
- **使用原則**:
  - ファイル全体読み込みは避け、シンボル単位で操作
  - 相対パスではなくシンボルの名前パスで指定
  - ts-patternによるマッチングを活用

### MCP Server選択の指針
- **ドキュメント参照が必要**: Context7を使用
- **コード解析・編集**: Serenaのシンボルツールを優先
- **エディタ診断**: IDE MCPサーバーを使用
- **ファイル操作**: 内蔵ツール（Read, Write, Edit）を使用

## CLAUDE.md 更新ルール

以下の場合に更新:
- データ整合性に関わる重要パターンの発見
- データ破損やバグを防ぐ制約の発見
- 新しい技術スタックやアーキテクチャパターンの導入
- MCP Server構成の変更

更新原則: Critical情報を簡潔に記載、詳細は別ドキュメントへ参照
