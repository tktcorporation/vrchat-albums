import { z } from 'zod';

import { BaseValueObject } from '../../lib/baseValueObject.js';

/**
 * VRChatの写真ファイルが保存されているディレクトリパス
 */
class VRChatPhotoDirPath extends BaseValueObject<
  'VRChatPhotoDirPath',
  string
> {}

export type { VRChatPhotoDirPath };
export const VRChatPhotoDirPathSchema = z
  .string()
  .transform((value) => new VRChatPhotoDirPath(value));
