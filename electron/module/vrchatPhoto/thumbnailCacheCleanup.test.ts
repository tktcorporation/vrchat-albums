import * as fs from 'node:fs';
import * as realOs from 'node:os';

import * as path from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupThumbnailCache,
  selectThumbnailCacheFilesToDelete,
  THUMBNAIL_CACHE_LIMITS,
  type ThumbnailCacheEntry,
} from './vrchatPhoto.service';

// キャッシュディレクトリは os.tmpdir() 配下に作られるため、テストごとの一時ディレクトリへ向ける
const tmpState = vi.hoisted(() => ({ dir: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    tmpdir: () => tmpState.dir || actual.tmpdir(),
  };
});

// 選定と削除の間に起きる再生成を再現するため、stat の直後に差し込める口を用意する
const statHook = vi.hoisted(() => ({
  afterStat: undefined as ((filePath: string) => void) | undefined,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      const result = await actual.stat(...args);
      statHook.afterStat?.(String(args[0]));
      return result;
    },
  };
});

const MB = 1024 * 1024;
const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const limits = {
  ...THUMBNAIL_CACHE_LIMITS,
  maxBytes: 100 * MB,
  cleanupThreshold: 0.9,
  targetRatio: 0.5,
};

const entry = (
  name: string,
  sizeMb: number,
  ageMs: number,
): ThumbnailCacheEntry => ({
  filePath: `/cache/${name}`,
  size: sizeMb * MB,
  mtimeMs: NOW - ageMs,
});

const selectPaths = (entries: readonly ThumbnailCacheEntry[]) =>
  selectThumbnailCacheFilesToDelete(entries, NOW, limits).map(
    (e) => e.filePath,
  );

describe('selectThumbnailCacheFilesToDelete', () => {
  it('閾値未満で期限内のファイルだけなら何も消さない', () => {
    const entries = [entry('a.webp', 40, HOUR), entry('b.webp', 49, 2 * HOUR)];
    expect(selectPaths(entries)).toEqual([]);
  });

  it('有効期限切れのサムネイルは容量に関係なく消す', () => {
    const entries = [
      entry('fresh.webp', 1, DAY),
      entry('expired.webp', 1, limits.expiryMs + 1),
    ];
    expect(selectPaths(entries)).toEqual(['/cache/expired.webp']);
  });

  it('取り残された一時ファイルは消し、書き込み中の可能性がある新しい一時ファイルは残す', () => {
    const entries = [
      entry('old.webp.tmp', 1, limits.staleTempFileMs + 1),
      entry('writing.webp.tmp', 1, 1000),
    ];
    expect(selectPaths(entries)).toEqual(['/cache/old.webp.tmp']);
  });

  it('閾値以上なら mtime が古い順に目標サイズ以下まで消す', () => {
    // 合計 100MB（閾値 90MB 以上）→ 目標 50MB 以下まで
    const entries = [
      entry('newest.webp', 25, 1 * HOUR),
      entry('oldest.webp', 25, 4 * HOUR),
      entry('newer.webp', 25, 2 * HOUR),
      entry('older.webp', 25, 3 * HOUR),
    ];
    expect(selectPaths(entries)).toEqual([
      '/cache/oldest.webp',
      '/cache/older.webp',
    ]);
  });

  it('期限切れの削除で閾値を下回れば、期限内のファイルは消さない', () => {
    const entries = [
      entry('expired.webp', 30, limits.expiryMs + 1),
      entry('a.webp', 40, HOUR),
      entry('b.webp', 40, 2 * HOUR),
    ];
    expect(selectPaths(entries)).toEqual(['/cache/expired.webp']);
  });

  it('容量超過の削減でも新しい一時ファイルは消さない', () => {
    const entries = [
      entry('writing.webp.tmp', 60, 1000),
      entry('a.webp', 40, HOUR),
    ];
    expect(selectPaths(entries)).toEqual(['/cache/a.webp']);
  });
});

describe('cleanupThumbnailCache（実ファイルシステム）', () => {
  let cacheDir: string;

  beforeEach(() => {
    tmpState.dir = fs.mkdtempSync(
      path.join(realOs.tmpdir(), 'vrchat-albums-thumb-test-'),
    );
    cacheDir = path.join(tmpState.dir, 'vrchat-albums-thumbnails');
    fs.mkdirSync(cacheDir, { recursive: true });
  });

  afterEach(() => {
    statHook.afterStat = undefined;
    fs.rmSync(tmpState.dir, { recursive: true, force: true });
    tmpState.dir = '';
  });

  const writeWithAge = (name: string, ageMs: number) => {
    const filePath = path.join(cacheDir, name);
    fs.writeFileSync(filePath, 'x');
    const mtime = new Date(Date.now() - ageMs);
    fs.utimesSync(filePath, mtime, mtime);
  };

  it('期限切れのサムネイルと取り残された一時ファイルを消し、それ以外は残す', async () => {
    writeWithAge('fresh.webp', HOUR);
    writeWithAge('expired.webp', THUMBNAIL_CACHE_LIMITS.expiryMs + DAY);
    writeWithAge(
      'stale.webp.tmp',
      THUMBNAIL_CACHE_LIMITS.staleTempFileMs + HOUR,
    );
    writeWithAge('writing.webp.tmp', 0);

    await cleanupThumbnailCache();

    expect(fs.readdirSync(cacheDir).toSorted()).toEqual([
      'fresh.webp',
      'writing.webp.tmp',
    ]);
  });

  it('選定後に同じパスへ再生成されたサムネイルは消さない', async () => {
    writeWithAge('expired.webp', THUMBNAIL_CACHE_LIMITS.expiryMs + DAY);
    const target = path.join(cacheDir, 'expired.webp');
    let statCount = 0;
    statHook.afterStat = (filePath) => {
      if (filePath !== target) {
        return;
      }
      statCount++;
      // 1 回目は選定時の stat。その後、削除前の再確認までに再生成が割り込んだ状況を作る
      if (statCount === 1) {
        fs.writeFileSync(target, 'regenerated');
      }
    };

    await cleanupThumbnailCache();

    expect(fs.readFileSync(target, 'utf8')).toBe('regenerated');
  });
});
