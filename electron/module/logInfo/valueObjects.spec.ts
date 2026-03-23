import { describe, expect, it } from 'vitest';

import * as valueObjects from './../../valueObjects';

describe('valueObjects', () => {
  describe('VRChatPhotoFileNameWithExt', () => {
    it('should be created from string', () => {
      const photoFileName = 'VRChat_2021-07-15_21-00-00.000_2560x1440.png';
      const vrchatPhotoFileNameWithExt =
        valueObjects.VRChatPhotoFileNameWithExtSchema.parse(photoFileName);
      expect(vrchatPhotoFileNameWithExt.value).toBe(photoFileName);
    });
    it('should be created from string', () => {
      const photoFileName = 'VRChat_2023-10-08_00-01-18.551_2560x1440.png';
      const vrchatPhotoFileNameWithExt =
        valueObjects.VRChatPhotoFileNameWithExtSchema.parse(photoFileName);
      expect(vrchatPhotoFileNameWithExt.value).toBe(photoFileName);
    });
  });
});
