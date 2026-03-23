import { z } from 'zod';

import { BaseValueObject } from '../../lib/baseValueObject.js';

/**
 * VRChatのログファイルが格納されているディレクトリのパス
 */
class VRChatLogFilesDirPath extends BaseValueObject<
  'VRChatLogFilesDirPath',
  string
> {}
/**
 * VRChatのログファイルが格納されているディレクトリのパス
 * (settingStoreから取得)
 */
class NotValidatedVRChatLogFilesDirPath extends BaseValueObject<
  'NotValidatedVRChatLogFilesDirPath',
  string
> {}
class VRChatLogFilePath extends BaseValueObject<'VRChatLogFilePath', string> {}

export type {
  VRChatLogFilesDirPath,
  VRChatLogFilePath,
  NotValidatedVRChatLogFilesDirPath,
};
export const VRChatLogFilesDirPathSchema = z.string().transform((value) => {
  return new VRChatLogFilesDirPath(value);
});
export const NotValidatedVRChatLogFilesDirPathSchema = z
  .string()
  .transform((value) => {
    return new NotValidatedVRChatLogFilesDirPath(value);
  });
export const VRChatLogFilePathSchema = z
  .string()
  .includes('output_log')
  .endsWith('.txt')
  .transform((value) => {
    return new VRChatLogFilePath(value);
  });
