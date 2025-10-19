<?xml version="1.0" encoding="UTF-8"?>
<claude-instructions>
  <description>This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.</description>

  <architecture>
    <overview>Electron desktop app for organizing VRChat photos by automatically associating them with log files.</overview>
    
    <tech-stack>
      <item>Electron</item>
      <item>React 18</item>
      <item>TypeScript</item>
      <item>Vite</item>
      <item>tRPC</item>
      <item>SQLite/Sequelize</item>
      <item>Tailwind/Radix UI</item>
      <item>ts-pattern</item>
      <item>neverthrow</item>
    </tech-stack>
    
    <structure>
      <directory path="/electron/">Main process (tRPC router in api.ts, business logic in /module/)</directory>
      <directory path="/src/v2/">Renderer process (React components, hooks, i18n)</directory>
    </structure>
  </architecture>

  <environment>
    <nodejs>20 LTS</nodejs>
    <package-manager>Yarn 4 (npm禁止)</package-manager>
  </environment>

  <critical-guidelines>
    <log-synchronization priority="critical" jp="データ整合性必須">
      <execution-order strict="true">appendLoglines → loadLogInfo → cache invalidation</execution-order>
      <violation-risk jp="違反すると写真が間違ったワールドに分類されます"/>
      <usage>
        <allowed>useLogSync hook (frontend) / syncLogs() service (backend)</allowed>
        <forbidden>Call append/load functions individually</forbidden>
      </usage>
      <sync-modes>
        <mode name="FULL">Complete processing (初回起動、設定更新時)</mode>
        <mode name="INCREMENTAL">Delta processing (通常更新、バックグラウンド)</mode>
      </sync-modes>
      <reference>docs/log-sync-architecture.md</reference>
    </log-synchronization>

    <task-completion-process>
      <step order="1">Code Implementation</step>
      <step order="2">yarn lint:fix</step>
      <step order="3">yarn lint</step>
      <step order="4">yarn test</step>
      <step order="5">Task Completion</step>
    </task-completion-process>
  </critical-guidelines>

  <architectural-patterns>
    <pattern name="tRPC Communication">
      <description>All communication between Electron main and renderer processes goes through tRPC routers defined in electron/api.ts</description>
    </pattern>

    <pattern name="Error Handling" jp="型安全・構造化システム">
      <layer name="Service">neverthrow Result pattern (Result&lt;T, E&gt;)</layer>
      <layer name="tRPC">UserFacingError with structured info (code/category/userMessage)</layer>
      <layer name="Frontend">parseErrorFromTRPC + Toast variant selection</layer>
      
      <structured-error-info>
        <field name="code" description="FILE_NOT_FOUND, DATABASE_ERROR, etc."/>
        <field name="category" description="ERROR_CATEGORIES enum値"/>
        <field name="userMessage" description="ユーザー向けメッセージ"/>
      </structured-error-info>
      
      <error-mapping>
        <file>electron/lib/errorHelpers.ts</file>
        <requirement>Result→UserFacingError bridging with ts-pattern</requirement>
        <requirement>ALL mappings MUST have default case (prevent "予期しないエラー")</requirement>
      </error-mapping>
      
      <frontend-processing>
        <function>parseErrorFromTRPC()</function>
        <function>getToastVariant(category) with ts-pattern</function>
      </frontend-processing>
      
      <toast-variant-mapping>
        <map category="FILE_NOT_FOUND" variant="warning" jp="準正常系"/>
        <map category="VALIDATION_ERROR" variant="warning" jp="ユーザー入力問題"/>
        <map category="SETUP_REQUIRED" variant="default" jp="初期設定"/>
        <map category="PERMISSION_DENIED" variant="destructive" jp="システムエラー"/>
        <map category="DATABASE_ERROR" variant="destructive" jp="重大エラー"/>
        <map category="NETWORK_ERROR" variant="destructive" jp="重大エラー"/>
      </toast-variant-mapping>
      <lint-enforcement>
        <command>yarn lint:neverthrow</command>
        <description>Enforces Result type usage in service layer functions</description>
        <config-file>.neverthrowlintrc.json</config-file>
        <reference>docs/lint-neverthrow.md</reference>
      </lint-enforcement>
    </pattern>

    <pattern name="ts-pattern Usage" priority="critical" jp="型安全・表現力向上必須">
      <mandatory>Replace ALL if statements with match() from ts-pattern</mandatory>
      <priority-targets>
        <target>Error handling conditionals</target>
        <target>Enum/string literal comparisons</target>
        <target>Type guards and instanceof checks</target>
        <target>Nested if-else chains</target>
      </priority-targets>
      <example>
        <![CDATA[
        import { match, P } from 'ts-pattern';
        
        // Replace: if (error instanceof Error) return handleError(error);
        return match(error)
          .with(P.instanceOf(Error), (err) => handleError(err))
          .otherwise((err) => { throw err; });
        ]]>
      </example>
      <exceptions>
        <exception>Simple boolean checks (if (isLoading))</exception>
        <exception>Complex business logic conditions</exception>
        <exception>Test assertions</exception>
      </exceptions>
      <benefits>Type inference, exhaustiveness checking, better readability</benefits>
    </pattern>

    <pattern name="Database Access">
      <models>Sequelize models in /electron/module/*/model.ts files</models>
      <services>Services wrap DB operations with Result types for error handling</services>
      <concurrency>DB queue system prevents concurrent write issues</concurrency>
    </pattern>

    <pattern name="Photo Processing">
      <exif>EXIF data extraction using exiftool-vendored</exif>
      <thumbnails>Image processing with sharp for thumbnails</thumbnails>
      <association>Automatic association with VRChat log files based on timestamps</association>
    </pattern>

    <pattern name="Timezone Handling" priority="critical" jp="日時データ整合性必須">
      <principle>全ての日時データをローカルタイムとして統一処理</principle>
      <log-parsing>parseLogDateTime() でVRChatログをローカルタイムとして解釈</log-parsing>
      <frontend-dates>new Date('YYYY-MM-DDTHH:mm:ss') でローカルタイム処理</frontend-dates>
      <database-storage>SequelizeがDateオブジェクトを自動的にUTCで保存</database-storage>
      <utc-conversion>JavaScript Dateオブジェクトがローカルタイム→UTC変換を自動実行</utc-conversion>
      <photo-timestamps>写真ファイル名の日時もローカルタイムとして処理</photo-timestamps>
      <test-pattern>electron/module/vrchatLog/parsers/timezone.test.ts</test-pattern>
      <critical-rule>日時処理では常にローカルタイムベースで実装、UTC変換はSequelize/JSに委ねる</critical-rule>
    </pattern>

    <pattern name="ValueObject" priority="critical" jp="型安全・カプセル化必須">
      <type-only-export>
        <![CDATA[
        class MyValueObject extends BaseValueObject<'MyValueObject', string> {}
        export type { MyValueObject };  // ✅ 型のみエクスポート
        export { MyValueObject };        // ❌ クラスエクスポート禁止
        ]]>
      </type-only-export>
      <instance-creation>
        <![CDATA[
        const obj = MyValueObjectSchema.parse(value);  // ✅ Zodスキーマ経由
        const obj = new MyValueObject(value);          // ❌ 直接new禁止
        ]]>
      </instance-creation>
      <validation-functions>
        <![CDATA[
        export const isValidMyValueObject = (value: string): boolean => {...}
        ]]>
      </validation-functions>
      <lint-enforcement>yarn lint:valueobjects で自動検証</lint-enforcement>
    </pattern>

    <pattern name="Electron Module Import" priority="critical" jp="Playwright テスト互換性必須">
      <forbidden>トップレベルで electron の app, BrowserWindow 等をインポート</forbidden>
      <example-bad>
        <![CDATA[
        // ❌ NEVER: Playwright テストでクラッシュ
        import { app } from 'electron';
        const logPath = app.getPath('logs');
        ]]>
      </example-bad>
      <example-good>
        <![CDATA[
        // ✅ OK: 遅延評価または動的インポート
        const getLogPath = () => {
          try {
            const { app } = require('electron');
            return app.getPath('logs');
          } catch {
            return '/tmp/test-logs';
          }
        };
        ]]>
      </example-good>
      <common-module-warning>logger.ts など共通モジュールでのトップレベルインポートは全体に影響</common-module-warning>
      <symptom>Playwright テストで electronApplication.firstWindow: Timeout エラー</symptom>
      <reference>docs/troubleshooting-migration-playwright-timeout.md</reference>
    </pattern>
  </architectural-patterns>

  <testing>
    <database-pattern>
      <![CDATA[
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
      ]]>
      <reference>electron/module/logInfo/service.spec.ts</reference>
    </database-pattern>

    <integration-test-separation>
      <unit-tests>*.test.ts</unit-tests>
      <integration-tests>*.integration.test.ts</integration-tests>
      <reason>Separating integration tests prevents database initialization conflicts</reason>
      <example>logInfoController.test.ts (mocked) vs logInfoController.integration.test.ts (real DB)</example>
    </integration-test-separation>

    <vitest-mock-issues>
      <issue>Electron app mocking may require vi.mock('electron') before other mocks</issue>
      <issue>Complex file system mocks may fail; use describe.skip() for problematic tests</issue>
      <issue>Dynamic imports don't always solve mock timing issues in vitest</issue>
    </vitest-mock-issues>

    <module-path-issues priority="critical" jp="相対パスの確認必須">
      <example>electron/module/vrchatLog/ → electron/lib/ = ../../lib/ (NOT ../../../lib/)</example>
      <symptom>TypeError: The "path" argument must be of type string. Received undefined</symptom>
      <cause>モックされた関数が undefined を返す（パスが間違っているため）</cause>
      <solution>import パスと vi.mock() パスの両方を修正</solution>
    </module-path-issues>
  </testing>

  <git-workflow>
    <branch-format>
      <pattern>{issue-number}/{type}/{summary}</pattern>
      <example>123/feat/add-user-search</example>
      <types>feat, fix, chore, docs, style, refactor, perf, test</types>
    </branch-format>
  </git-workflow>

  <auto-generated-files jp="変更禁止">
    <file>src/assets/licenses.json</file>
    <file>yarn.lock</file>
    <file>CHANGELOG.md</file>
  </auto-generated-files>

  <mcp-servers>
    <server name="IDE" id="mcp__ide__">
      <description>VS Code統合機能を提供。エディタの診断情報取得やコード実行に使用。</description>
      <functions>getDiagnostics, executeCode</functions>
    </server>

    <server name="Context7" id="mcp__context7__">
      <description>最新のライブラリドキュメント取得用。</description>
      <usage>
        <step order="1">resolve-library-id: ライブラリ名からContext7互換IDを取得</step>
        <step order="2">get-library-docs: IDを使用してドキュメントを取得</step>
      </usage>
      <supported-libraries>React, Next.js, Supabase, MongoDB等の主要ライブラリ</supported-libraries>
    </server>

    <server name="Serena" id="mcp__serena__">
      <description>セマンティックコード解析とシンボルベースの編集。</description>
      <functions>
        <symbol-ops>find_symbol, replace_symbol_body, insert_before_symbol, insert_after_symbol, find_referencing_symbols, get_symbols_overview</symbol-ops>
        <memory-ops>write_memory, read_memory, onboarding</memory-ops>
      </functions>
      <principles>
        <principle>ファイル全体読み込みは避け、シンボル単位で操作</principle>
        <principle>相対パスではなくシンボルの名前パスで指定</principle>
        <principle>ts-patternによるマッチングを活用</principle>
      </principles>
    </server>

    <selection-guidelines>
      <guideline condition="ドキュメント参照が必要">Context7を使用</guideline>
      <guideline condition="コード解析・編集">Serenaのシンボルツールを優先</guideline>
      <guideline condition="エディタ診断">IDE MCPサーバーを使用</guideline>
      <guideline condition="ファイル操作">内蔵ツール（Read, Write, Edit）を使用</guideline>
    </selection-guidelines>
  </mcp-servers>
</claude-instructions>
