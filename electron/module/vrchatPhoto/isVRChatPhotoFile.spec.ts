import { describe, expect, it } from 'vitest';

import { isVRChatPhotoFile } from './vrchatPhoto.service';

describe('isVRChatPhotoFile', () => {
  it('should accept VRChat PNG photos', () => {
    expect(
      isVRChatPhotoFile('VRChat_2024-01-15_10-00-00.000_1920x1080.png'),
    ).toBe(true);
  });
  it('should accept World Join JPEG images', () => {
    expect(
      isVRChatPhotoFile('VRChat_2024-01-15_12-34-56.000_wrld_xxx.jpeg'),
    ).toBe(true);
  });
  it('should reject non-VRChat files', () => {
    expect(isVRChatPhotoFile('photo.png')).toBe(false);
  });
  it('should reject .jpg extension', () => {
    expect(
      isVRChatPhotoFile('VRChat_2024-01-15_12-34-56.000_wrld_xxx.jpg'),
    ).toBe(false);
  });
});
