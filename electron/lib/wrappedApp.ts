import * as os from 'node:os';
import * as path from 'node:path';

import { withElectronApp } from './electronModules';

/**
 * テスト/非 Electron 環境向けの userData フォールバックパス。
 * `os.tmpdir()` を使うことで OS 非依存（旧 `/tmp/test-user-data` は Windows で機能しなかった）。
 */
const TEST_USER_DATA_PATH = path.join(
  os.tmpdir(),
  'vrchat-albums-test-user-data',
);

/**
 * Get the path to the user data directory.
 * ex. C:\Users\username\AppData\Roaming\app-name
 */
export const getAppUserDataPath = () =>
  withElectronApp(TEST_USER_DATA_PATH, (app) => app.getPath('userData'));
