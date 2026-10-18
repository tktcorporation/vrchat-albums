import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readXmpTagsBatch } from '../../lib/wrappedExifTool';
import { extractAndSaveMetadataBatch } from './service';
import {
  createOrUpdatePhotoMetadataBatch,
  filterPathsWithoutMetadata,
} from './vrchatPhotoMetadata.model';

vi.mock('../../lib/logger');
vi.mock('../../lib/wrappedExifTool', () => ({
  readXmpTagsBatch: vi.fn(),
}));
vi.mock('./vrchatPhotoMetadata.model', () => ({
  createOrUpdatePhotoMetadataBatch: vi.fn(),
  filterPathsWithoutMetadata: vi.fn(),
}));

const photoPaths = [
  '/photos/VRChat_2025-06-01_10-00-00.000_1920x1080.png',
  '/photos/VRChat_2025-06-01_10-00-01.000_1920x1080.png',
];

describe('extractAndSaveMetadataBatch の進捗', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(filterPathsWithoutMetadata).mockImplementation((paths) =>
      Promise.resolve(paths),
    );
    vi.mocked(readXmpTagsBatch).mockImplementation((paths) =>
      Promise.resolve(
        paths.map(() => ({
          data: { authorId: 'usr_test', author: 'Tester' },
        })),
      ),
    );
  });

  it('DB への保存が終わるまで総件数を報告しない', async () => {
    const events: string[] = [];
    vi.mocked(createOrUpdatePhotoMetadataBatch).mockImplementation(() => {
      events.push('write');
      return Promise.resolve([]);
    });

    const saved = await Effect.runPromise(
      extractAndSaveMetadataBatch(photoPaths, {
        onProgress: (processed, total) => {
          events.push(`progress:${processed}/${total}`);
        },
      }),
    );

    expect(saved).toBe(2);
    expect(events).toEqual(['progress:0/2', 'write', 'progress:2/2']);
  });

  it('読み取りを分けた途中の区切りでは進捗を報告し、総件数は DB への保存の後に報告する', async () => {
    // XMP の読み取りは 500 件ずつに分かれる。1,200 件なら 500・1,000 で途中の進捗が出る
    const manyPaths = Array.from(
      { length: 1200 },
      (_, i) =>
        `/photos/VRChat_2025-06-01_10-00-00.${String(i).padStart(3, '0')}_${i}.png`,
    );
    const events: string[] = [];
    vi.mocked(createOrUpdatePhotoMetadataBatch).mockImplementation(() => {
      events.push('write');
      return Promise.resolve([]);
    });

    await Effect.runPromise(
      extractAndSaveMetadataBatch(manyPaths, {
        onProgress: (processed, total) => {
          events.push(`progress:${processed}/${total}`);
        },
      }),
    );

    expect(readXmpTagsBatch).toHaveBeenCalledTimes(3);
    expect(events).toEqual([
      'progress:0/1200',
      'progress:500/1200',
      'progress:1000/1200',
      'write',
      'progress:1200/1200',
    ]);
  });

  it('DB への保存に失敗したら総件数を報告しない', async () => {
    const reported: number[] = [];
    vi.mocked(createOrUpdatePhotoMetadataBatch).mockRejectedValue(
      new Error('db locked'),
    );

    const result = await Effect.runPromise(
      Effect.either(
        extractAndSaveMetadataBatch(photoPaths, {
          onProgress: (processed) => {
            reported.push(processed);
          },
        }),
      ),
    );

    expect(result._tag).toBe('Left');
    expect(reported).not.toContain(photoPaths.length);
  });

  it('保存するメタデータが無ければ読み取り後に総件数を報告する', async () => {
    vi.mocked(readXmpTagsBatch).mockImplementation((paths) =>
      Promise.resolve(paths.map(() => ({}))),
    );
    const reported: number[] = [];

    const saved = await Effect.runPromise(
      extractAndSaveMetadataBatch(photoPaths, {
        onProgress: (processed) => {
          reported.push(processed);
        },
      }),
    );

    expect(saved).toBe(0);
    expect(createOrUpdatePhotoMetadataBatch).not.toHaveBeenCalled();
    expect(reported.at(-1)).toBe(photoPaths.length);
  });
});
