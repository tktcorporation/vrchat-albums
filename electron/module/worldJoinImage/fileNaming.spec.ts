import * as datefns from 'date-fns';
import { describe, expect, it } from 'vitest';
import {
  generateWorldJoinImageFileName,
  generateWorldJoinImagePath,
  isWorldJoinImageFile,
} from './fileNaming';

describe('generateWorldJoinImageFileName', () => {
  it('should generate filename in VRChat_YYYY-MM-DD_HH-mm-ss.SSS_wrld_xxx.jpeg format', () => {
    const date = datefns.parseISO('2024-01-15T12:34:56.000');
    const worldId = 'wrld_6fecf18a-ab96-43f2-82dc-ccf79f17c34f';
    const result = generateWorldJoinImageFileName(date, worldId);
    expect(result).toBe(
      'VRChat_2024-01-15_12-34-56.000_wrld_6fecf18a-ab96-43f2-82dc-ccf79f17c34f.jpeg',
    );
  });

  it('should use local time (not UTC)', () => {
    const date = new Date('2024-01-15T03:00:00.000');
    const worldId = 'wrld_00000000-0000-0000-0000-000000000000';
    const result = generateWorldJoinImageFileName(date, worldId);
    expect(result).toContain('03-00-00.000');
  });
});

describe('generateWorldJoinImagePath', () => {
  it('should place file in YYYY-MM subdirectory', () => {
    const date = datefns.parseISO('2024-01-15T12:34:56.000');
    const worldId = 'wrld_6fecf18a-ab96-43f2-82dc-ccf79f17c34f';
    const basePath = '/photos/VRChat';
    const result = generateWorldJoinImagePath(basePath, date, worldId);
    expect(result).toContain('2024-01');
    expect(result).toMatch(/\.jpeg$/);
  });
});

describe('isWorldJoinImageFile', () => {
  it('should return true for world join image files', () => {
    expect(
      isWorldJoinImageFile(
        'VRChat_2024-01-15_12-34-56.000_wrld_6fecf18a-ab96-43f2-82dc-ccf79f17c34f.jpeg',
      ),
    ).toBe(true);
  });
  it('should return false for regular VRChat photos', () => {
    expect(
      isWorldJoinImageFile('VRChat_2024-01-15_10-00-00.000_1920x1080.png'),
    ).toBe(false);
  });
  it('should return false for non-VRChat files', () => {
    expect(isWorldJoinImageFile('photo.jpeg')).toBe(false);
  });
});
