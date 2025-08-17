/**
 * Get the path to the user data directory.
 * ex. C:\Users\username\AppData\Roaming\app-name
 */
export const getAppUserDataPath = () => {
  try {
    const { app } = require('electron');
    return app.getPath('userData');
  } catch {
    // テストまたは非Electron環境
    return '/tmp/test-user-data';
  }
};

// /**
//  * Get the path to the app directory.
//  * ex. C:\Program Files\app-name
//  */
// export const getAppPath = () => {
//   return app.getAppPath();
// };
