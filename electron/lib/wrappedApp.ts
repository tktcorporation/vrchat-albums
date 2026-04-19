import { withElectronApp } from './electronModules';

/**
 * Get the path to the user data directory.
 * ex. C:\Users\username\AppData\Roaming\app-name
 */
export const getAppUserDataPath = () =>
  withElectronApp('/tmp/test-user-data', (app) => app.getPath('userData'));
