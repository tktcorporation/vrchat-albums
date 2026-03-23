import path from 'node:path';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { type getSettingStore, initSettingStoreForTest } from '../settingStore';
import { getValidVRChatLogFileDir } from './service';

describe('vrchatLogFileDir service', () => {
  it('getValidVRChatLogFileDir', async () => {
    // project_dir/debug/logs
    const storedVRChatLogFilesDirPath = {
      value: path.join(process.cwd(), 'debug', 'logs'),
    };
    initSettingStoreForTest({
      getLogFilesDir: () => storedVRChatLogFilesDirPath.value,
    } as unknown as ReturnType<typeof getSettingStore>);

    const value = await Effect.runPromise(getValidVRChatLogFileDir());
    expect(typeof value.path.value === 'string').toBe(true);
  });
});
