/**
 * VRChat 写真メタデータパーサーのテスト
 *
 * extractOfficialMetadata: exiftool Tags から VRChat公式XMPメタデータを抽出する関数のテスト
 * parsePhotoMetadata: ファイルパスからメタデータを読み取る関数のテスト
 */

import { Cause, Effect, Exit, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { extractOfficialMetadata, parsePhotoMetadata } from './parser';

// ============================================================================
// extractOfficialMetadata テスト
// ============================================================================

describe('extractOfficialMetadata', () => {
  it('should extract VRChat official metadata from exiftool tags', () => {
    const tags = {
      AuthorID: 'usr_12345678-1234-1234-1234-123456789012',
      Author: 'TestPhotographer',
      WorldID: 'wrld_12345678-1234-1234-1234-123456789012',
      WorldDisplayName: 'Beautiful World',
    };

    const result = extractOfficialMetadata(tags);
    expect(result).not.toBeNull();
    expect(result?.authorId).toBe('usr_12345678-1234-1234-1234-123456789012');
    expect(result?.authorDisplayName).toBe('TestPhotographer');
    expect(result?.worldId).toBe('wrld_12345678-1234-1234-1234-123456789012');
    expect(result?.worldDisplayName).toBe('Beautiful World');
  });

  it('should handle vrc: prefixed field names', () => {
    const tags = {
      'vrc:AuthorID': 'usr_test',
      Author: 'TestUser',
      'vrc:WorldID': 'wrld_test',
      'vrc:WorldDisplayName': 'Test World',
    };

    const result = extractOfficialMetadata(tags);
    expect(result).not.toBeNull();
    expect(result?.authorId).toBe('usr_test');
    expect(result?.worldId).toBe('wrld_test');
    expect(result?.worldDisplayName).toBe('Test World');
  });

  it('should return null when no AuthorID is present', () => {
    const tags = {
      Author: 'SomeUser',
      WorldID: 'wrld_test',
    };

    const result = extractOfficialMetadata(tags);
    expect(result).toBeNull();
  });

  it('should handle missing world info (private world)', () => {
    const tags = {
      AuthorID: 'usr_test',
      Author: 'TestUser',
    };

    const result = extractOfficialMetadata(tags);
    expect(result).not.toBeNull();
    expect(result?.worldId).toBeNull();
    expect(result?.worldDisplayName).toBeNull();
  });

  it('should return null for empty tags', () => {
    const result = extractOfficialMetadata({});
    expect(result).toBeNull();
  });

  it('should fallback to Creator field for author display name', () => {
    const tags = {
      AuthorID: 'usr_test',
      Creator: 'CreatorName',
      WorldID: 'wrld_test',
      WorldDisplayName: 'World',
    };

    const result = extractOfficialMetadata(tags);
    expect(result).not.toBeNull();
    expect(result?.authorDisplayName).toBe('CreatorName');
  });

  it('should use authorId as display name when no author name fields exist', () => {
    const tags = {
      AuthorID: 'usr_test',
    };

    const result = extractOfficialMetadata(tags);
    expect(result).not.toBeNull();
    expect(result?.authorDisplayName).toBe('usr_test');
  });

  it('should treat empty string worldId as null', () => {
    const tags = {
      AuthorID: 'usr_test',
      Author: 'TestUser',
      WorldID: '',
    };

    const result = extractOfficialMetadata(tags);
    expect(result).not.toBeNull();
    expect(result?.worldId).toBeNull();
  });
});

// ============================================================================
// parsePhotoMetadata テスト
// ============================================================================

describe('parsePhotoMetadata', () => {
  it('should return metadata when exif tags contain VRChat metadata', async () => {
    const mockReadExifTags = async () => ({
      AuthorID: 'usr_abc',
      Author: 'Photographer',
      WorldID: 'wrld_xyz',
      WorldDisplayName: 'My World',
    });

    const value = await Effect.runPromise(
      parsePhotoMetadata('/path/to/photo.png', mockReadExifTags),
    );
    expect(value.authorId).toBe('usr_abc');
    expect(value.authorDisplayName).toBe('Photographer');
    expect(value.worldId).toBe('wrld_xyz');
    expect(value.worldDisplayName).toBe('My World');
  });

  it('should return NO_METADATA_FOUND when no VRChat metadata exists', async () => {
    const mockReadExifTags = async () => ({
      Make: 'Canon',
      Model: 'EOS R5',
    });

    const exit = await Effect.runPromiseExit(
      parsePhotoMetadata('/path/to/photo.png', mockReadExifTags),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failOpt = Cause.failureOption(exit.cause);
      expect(Option.isSome(failOpt)).toBe(true);
      if (Option.isSome(failOpt)) {
        expect(failOpt.value._tag).toBe('NoMetadataFound');
      }
    }
  });

  it('should return MetadataParseError when exif reading fails', async () => {
    const mockReadExifTags = async () => {
      throw new Error('File not found');
    };

    const exit = await Effect.runPromiseExit(
      parsePhotoMetadata('/nonexistent/photo.png', mockReadExifTags),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failOpt = Cause.failureOption(exit.cause);
      expect(Option.isSome(failOpt)).toBe(true);
      if (Option.isSome(failOpt)) {
        expect(failOpt.value._tag).toBe('MetadataParseError');
        expect(failOpt.value.message).toContain('File not found');
      }
    }
  });
});
