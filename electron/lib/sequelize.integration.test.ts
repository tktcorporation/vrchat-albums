import {
  afterAll,
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

// getAppVersion をモックして、テスト内でバージョンを制御する。
// pnpm 経由の実行時は process.env.npm_package_version が package.json の値になるため、
// electron の getVersion モックだけではバージョンが一致しない可能性がある。
vi.mock('./../module/settings/service', () => ({
  getAppVersion: vi.fn().mockReturnValue('1.0.0-test'),
}));

/**
 * syncRDBClient のマイグレーションスキップ動作を実DBで検証する統合テスト。
 *
 * 背景: match() の async コールバックが返す Promise<boolean> を await せずに
 * truthy チェックしていたバグにより、同一バージョンでの再起動時も全テーブルの
 * ALTER TABLE スキーマ比較が毎回実行されていた。
 * このテストで、同一バージョンでの2回目の呼び出しがスキップされることを保証する。
 */
describe('syncRDBClient migration skip', () => {
  beforeAll(async () => {
    const client = await import('./sequelize');
    await client.__initTestRDBClient();
  }, 10000);

  beforeEach(async () => {
    const client = await import('./sequelize');
    await client.__forceSyncRDBClient();
  });

  afterAll(async () => {
    const client = await import('./sequelize');
    await client.__cleanupTestRDBClient();
  });

  it('同一バージョンでの2回目の呼び出しはスキーマ同期をスキップする', async () => {
    const client = await import('./sequelize');
    const { Migrations } = await import('./sequelize/migrations.model');

    // __forceSyncRDBClient はテーブルを再作成するが Migrations.create() も呼ぶ。
    // テスト対象の syncRDBClient のみで検証するため、既存レコードをクリアする。
    await Migrations.destroy({ where: {} });

    // 1回目: checkRequired=true で通常フローを実行
    // Migrations テーブルにバージョンが記録される
    await client.syncRDBClient();
    const countAfterFirst = await Migrations.count();
    expect(countAfterFirst).toBe(1);

    // 2回目: 同一バージョンなのでスキップされるべき
    await client.syncRDBClient();
    const countAfterSecond = await Migrations.count();

    // スキップが正しく動作していれば、Migrations レコードは1のまま
    // バグがあると executeSyncRDB が再実行され、レコードが2になる
    expect(countAfterSecond).toBe(1);
  });

  it('checkMigrationRDBClient はバージョンが一致しない場合に true を返す', async () => {
    const client = await import('./sequelize');
    const { Migrations } = await import('./sequelize/migrations.model');

    // beforeEach で __forceSyncRDBClient が実行され、Migrations に現バージョンが記録される。
    // 異なるバージョンで migration check すると true（migration 必要）が返るべき。
    const needsMigration =
      await client.checkMigrationRDBClient('different-version');
    expect(needsMigration).toBe(true);

    // 現バージョンと同じなら false（スキップ）が返るべき
    const latestMigration = await Migrations.findOne({
      order: [['createdAt', 'DESC']],
    });
    const currentVersion = latestMigration?.version ?? '';
    const noMigration = await client.checkMigrationRDBClient(currentVersion);
    expect(noMigration).toBe(false);
  });

  // ADR-004 の不変条件を機械的に守るためのリグレッションガード。
  // `retry-as-promised` の `timeout` をクエリ全体に被せると、PCスリープ復帰直後の
  // SQLite 初回アクセスなど正常処理可能なケースで `TimeoutError` が発生する。
  // 詳細: docs/adr/004-no-sequelize-retry-timeout.md
  it('Sequelize retry オプションが ADR-004 の不変条件を満たす', async () => {
    const client = await import('./sequelize');
    const retryOptions = (
      client.getRDBClient().__client.options as {
        retry?: Record<string, unknown>;
      }
    ).retry;

    expect(retryOptions).toBeDefined();
    // timeout を再導入してはならない（クエリ全体への壁時間禁止）
    expect(retryOptions?.timeout).toBeUndefined();
    // max は Effect 上位リトライとの合算待機を抑えるため小さく保つ
    expect(retryOptions?.max).toBeLessThanOrEqual(3);
    // 診断容易性（Sentry集約等）のため name は明示する
    expect(retryOptions?.name).toBe('sequelize-query');
  });
});
