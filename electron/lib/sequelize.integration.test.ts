import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
  },
}));

/**
 * syncRDBClient のスキーマ同期判定を実DBで検証する統合テスト。
 *
 * SQLite の `sync({ alter: true })` は差分の有無に関係なく全列でテーブルを作り直すため、
 * 同期はモデル定義のスキーマ指紋が変わったときだけ走り、アプリバージョンの変化では走らないことを保証する。
 */
describe('syncRDBClient schema sync decision', () => {
  beforeAll(async () => {
    const client = await import('./sequelize');
    await client.__initTestRDBClient();
  }, 10000);

  beforeEach(async () => {
    const client = await import('./sequelize');
    // vitest.setup.ts が sequelize.ts を先に読み込むため getAppVersion は vi.mock で差し替えられない。
    // getAppVersion が優先して読む npm_package_version でアプリバージョンを制御する。
    vi.stubEnv('npm_package_version', '1.0.0-test');
    await client.__forceSyncRDBClient();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    const client = await import('./sequelize');
    await client.__cleanupTestRDBClient();
  });

  /**
   * __forceSyncRDBClient はテーブルを再作成した上で Migrations.create() も呼ぶ。
   * syncRDBClient だけの挙動を見るため、記録をクリアした状態から始める。
   */
  const clearMigrations = async () => {
    const { Migrations } = await import('./sequelize/migrations.model');
    await Migrations.destroy({ where: {} });
  };

  it('モデル定義が同じなら2回目の呼び出しはスキーマ同期をスキップする', async () => {
    const client = await import('./sequelize');
    const { Migrations } = await import('./sequelize/migrations.model');
    await clearMigrations();

    await client.syncRDBClient();
    expect(await Migrations.count()).toBe(1);

    await client.syncRDBClient();
    expect(await Migrations.count()).toBe(1);
  });

  it('アプリバージョンだけが変わってもスキーマ同期をスキップする', async () => {
    const client = await import('./sequelize');
    const { Migrations } = await import('./sequelize/migrations.model');
    await clearMigrations();

    await client.syncRDBClient();
    expect(await Migrations.count()).toBe(1);

    vi.stubEnv('npm_package_version', '2.0.0-test');
    expect(await client.checkMigrationRDBClient()).toBe(false);
    await client.syncRDBClient();

    expect(await Migrations.count()).toBe(1);
    const latest = await Migrations.findOne({ order: [['id', 'DESC']] });
    expect(latest?.version).toBe('1.0.0-test');
  });

  it('記録済みの指紋がモデル定義と異なれば同期し、現在の指紋を記録する', async () => {
    const client = await import('./sequelize');
    const { Migrations } = await import('./sequelize/migrations.model');
    await clearMigrations();
    await Migrations.create({
      version: '1.0.0-test',
      migratedAt: new Date(),
      schemaFingerprint: 'fingerprint-of-older-models',
    });

    expect(await client.checkMigrationRDBClient()).toBe(true);
    await client.syncRDBClient();

    expect(await Migrations.count()).toBe(2);
    const latest = await Migrations.findOne({ order: [['id', 'DESC']] });
    expect(latest?.schemaFingerprint).toBe(
      client.getCurrentSchemaFingerprint(),
    );
    expect(await client.checkMigrationRDBClient()).toBe(false);
  });

  it('指紋列を持たない Migrations テーブルの DB は同期し、列を追加して指紋を記録する', async () => {
    const client = await import('./sequelize');
    const { Migrations } = await import('./sequelize/migrations.model');
    const sequelize = client.getRDBClient().__client;
    await clearMigrations();
    // 指紋を記録する前の版で作られた DB を再現する
    await sequelize.query(
      'ALTER TABLE `Migrations` DROP COLUMN `schemaFingerprint`',
    );
    await sequelize.query(
      "INSERT INTO `Migrations` (`version`, `migratedAt`, `createdAt`, `updatedAt`) VALUES ('0.9.0', datetime('now'), datetime('now'), datetime('now'))",
    );

    expect(await client.checkMigrationRDBClient()).toBe(true);
    await client.syncRDBClient();

    const latest = await Migrations.findOne({ order: [['id', 'DESC']] });
    expect(latest?.schemaFingerprint).toBe(
      client.getCurrentSchemaFingerprint(),
    );
    expect(await client.checkMigrationRDBClient()).toBe(false);
  });

  it('テーブルが1つも無い DB では全テーブルを作成する', async () => {
    const client = await import('./sequelize');
    const sequelize = client.getRDBClient().__client;
    await sequelize.queryInterface.dropAllTables();

    expect(await client.checkMigrationRDBClient()).toBe(true);
    await client.syncRDBClient();

    const tables = (await sequelize.queryInterface.listTables()).map(
      (table) => table.tableName,
    );
    expect(tables).toEqual(
      expect.arrayContaining([
        'VRChatWorldJoinLogModels',
        'VRChatPlayerJoinLogModels',
        'VRChatPhotoPathModels',
        'Migrations',
      ]),
    );
    expect(await client.checkMigrationRDBClient()).toBe(false);
  });

  it('同期が途中で失敗した場合は指紋を記録せず、次回も同期が必要と判定する', async () => {
    const client = await import('./sequelize');
    const { Migrations } = await import('./sequelize/migrations.model');
    const { VRChatPhotoPathModel } =
      await import('../module/vrchatPhoto/model/vrchatPhotoPath.model');
    await clearMigrations();

    const syncSpy = vi
      .spyOn(VRChatPhotoPathModel, 'sync')
      .mockRejectedValueOnce(new Error('simulated sync failure'));

    await expect(client.syncRDBClient()).rejects.toThrow(
      'simulated sync failure',
    );
    syncSpy.mockRestore();

    expect(await Migrations.count()).toBe(0);
    expect(await client.checkMigrationRDBClient()).toBe(true);

    await client.syncRDBClient();
    expect(await Migrations.count()).toBe(1);
  });

  it('スキーマ指紋は呼び出しごとに同じ値を返す', async () => {
    const client = await import('./sequelize');
    const fingerprint = client.getCurrentSchemaFingerprint();
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(client.getCurrentSchemaFingerprint()).toBe(fingerprint);
  });

  // ADR-004 の不変条件を機械的に守るためのリグレッションガード。
  // `retry-as-promised` の `timeout` をクエリ全体に被せると、PCスリープ復帰直後の
  // SQLite 初回アクセスなど正常処理可能なケースで `TimeoutError` が発生する。
  // 詳細: docs/adr/004-no-sequelize-retry-timeout.md
  it('Sequelize retry オプションが ADR-004 の不変条件を満たす', async () => {
    const client = await import('./sequelize');
    const sequelizeOptions = client.getRDBClient().__client.options as {
      retry?: { timeout?: unknown; max?: number; name?: string };
    };
    const retryOptions = sequelizeOptions.retry;

    expect(retryOptions).toBeDefined();
    // timeout を再導入してはならない（クエリ全体への壁時間禁止）。
    // ADR の「未指定」を機械的に守るため、`timeout: undefined` の明示も含めてキー不在を要求する。
    expect('timeout' in (retryOptions as Record<string, unknown>)).toBe(false);
    // max は ADR-004 で 3 に固定。引き下げ・引き上げいずれも ADR の見直しを伴う
    expect(retryOptions?.max).toBe(3);
    // 診断容易性（Sentry集約等）のため name は明示する。文字列は SSOT として export 済み
    expect(retryOptions?.name).toBe(client.SEQUELIZE_RETRY_NAME);
  });
});
