/**
 * VRChat 写真メタデータパーサーのテスト
 *
 * extractOfficialMetadata: exif-native の XMP 読み取り結果から VRChat公式メタデータを抽出する関数のテスト
 */

import type { JsVrcXmpMetadata } from '@vrchat-albums/exif-native';
import { describe, expect, it } from 'vitest';

import { extractOfficialMetadata } from './parser';

// ============================================================================
// extractOfficialMetadata テスト
// ============================================================================

describe('extractOfficialMetadata', () => {
  it('should extract VRChat official metadata from native XMP result', () => {
    const xmp: JsVrcXmpMetadata = {
      authorId: 'usr_12345678-1234-1234-1234-123456789012',
      author: 'TestPhotographer',
      worldId: 'wrld_12345678-1234-1234-1234-123456789012',
      worldDisplayName: 'Beautiful World',
    };

    const result = extractOfficialMetadata(xmp);
    expect(result).not.toBeNull();
    expect(result?.authorId).toBe('usr_12345678-1234-1234-1234-123456789012');
    expect(result?.authorDisplayName).toBe('TestPhotographer');
    expect(result?.worldId).toBe('wrld_12345678-1234-1234-1234-123456789012');
    expect(result?.worldDisplayName).toBe('Beautiful World');
  });

  it('should return null when no authorId is present', () => {
    const result = extractOfficialMetadata({
      author: 'SomeUser',
      worldId: 'wrld_test',
    });
    expect(result).toBeNull();
  });

  it('should return null when authorId is an empty string', () => {
    const result = extractOfficialMetadata({
      authorId: '',
      author: 'SomeUser',
    });
    expect(result).toBeNull();
  });

  it('should return null for an empty result', () => {
    const result = extractOfficialMetadata({});
    expect(result).toBeNull();
  });

  it('should handle missing world info (private world)', () => {
    const result = extractOfficialMetadata({
      authorId: 'usr_test',
      author: 'TestUser',
    });
    expect(result).not.toBeNull();
    expect(result?.worldId).toBeNull();
    expect(result?.worldDisplayName).toBeNull();
  });

  it('should use authorId as display name when author is missing', () => {
    const result = extractOfficialMetadata({ authorId: 'usr_test' });
    expect(result).not.toBeNull();
    expect(result?.authorDisplayName).toBe('usr_test');
  });

  it('should use authorId as display name when author is an empty string', () => {
    const result = extractOfficialMetadata({
      authorId: 'usr_test',
      author: '',
    });
    expect(result).not.toBeNull();
    expect(result?.authorDisplayName).toBe('usr_test');
  });

  it('should treat empty string world fields as null', () => {
    const result = extractOfficialMetadata({
      authorId: 'usr_test',
      author: 'TestUser',
      worldId: '',
      worldDisplayName: '',
    });
    expect(result).not.toBeNull();
    expect(result?.worldId).toBeNull();
    expect(result?.worldDisplayName).toBeNull();
  });
});
