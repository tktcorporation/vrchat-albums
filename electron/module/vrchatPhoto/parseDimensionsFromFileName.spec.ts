import { describe, expect, it } from 'vitest';

import { parseDimensionsFromFileName } from './vrchatPhoto.service';

describe('parseDimensionsFromFileName', () => {
  it('標準的な VRChat PNG 写真から寸法を抽出できる', () => {
    const result = parseDimensionsFromFileName(
      '/photos/VRChat_2024-01-15_10-00-00.000_1920x1080.png',
    );
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  it('異なる解像度のファイルから寸法を抽出できる', () => {
    expect(
      parseDimensionsFromFileName(
        '/photos/VRChat_2024-01-15_10-00-00.000_1280x720.png',
      ),
    ).toEqual({ width: 1280, height: 720 });

    expect(
      parseDimensionsFromFileName(
        '/photos/VRChat_2024-01-15_10-00-00.000_3840x2160.png',
      ),
    ).toEqual({ width: 3840, height: 2160 });
  });

  it('World Join JPEG（寸法なし、ワールドID付き）は null を返す', () => {
    const result = parseDimensionsFromFileName(
      '/photos/VRChat_2024-01-15_12-34-56.000_wrld_xxx.jpeg',
    );
    expect(result).toBeNull();
  });

  it('パスなしのファイル名でも動作する', () => {
    const result = parseDimensionsFromFileName(
      'VRChat_2024-01-15_10-00-00.000_1920x1080.png',
    );
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  it('Windows スタイルのパスでも動作する', () => {
    const result = parseDimensionsFromFileName(
      String.raw`C:\Users\user\Pictures\VRChat\VRChat_2024-01-15_10-00-00.000_1920x1080.png`,
    );
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  it('寸法が含まれないファイル名は null を返す', () => {
    expect(parseDimensionsFromFileName('/photos/photo.png')).toBeNull();
    expect(
      parseDimensionsFromFileName('/photos/VRChat_2024-01-15_10-00-00.000.png'),
    ).toBeNull();
  });

  it('寸法が 0 の場合は null を返す', () => {
    expect(
      parseDimensionsFromFileName(
        '/photos/VRChat_2024-01-15_10-00-00.000_0x1080.png',
      ),
    ).toBeNull();
    expect(
      parseDimensionsFromFileName(
        '/photos/VRChat_2024-01-15_10-00-00.000_1920x0.png',
      ),
    ).toBeNull();
  });

  it('寸法が極端に大きい場合は null を返す', () => {
    expect(
      parseDimensionsFromFileName(
        '/photos/VRChat_2024-01-15_10-00-00.000_99999x1080.png',
      ),
    ).toBeNull();
  });
});
