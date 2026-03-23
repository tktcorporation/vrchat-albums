import { describe, expect, it } from 'vitest';

import * as valueObjects from './index';

describe('valueObjects', () => {
  it('should parse valid VRChat photo file name', () => {
    const photoFileName = 'VRChat_2023-10-01_03-01-18.551_2560x1440.png';

    expect(() =>
      valueObjects.VRChatPhotoFileNameWithExtSchema.parse(photoFileName),
    ).not.toThrow();
  });

  it('should throw error when invalid VRChat photo file name', () => {
    const photoFileName = 'invalid.png';

    expect(() =>
      valueObjects.VRChatPhotoFileNameWithExtSchema.parse(photoFileName),
    ).toThrow();
  });
});
