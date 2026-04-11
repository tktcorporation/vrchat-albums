/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const config = {
  asar: true,
  files: ['main', 'src/out'],
  directories: {
    buildResources: 'assets',
  },
  extraResources: [
    {
      from: './assets/',
      to: 'assets',
    },
    {
      from: './electron/resources/fonts/',
      to: 'fonts',
    },
  ],
  asarUnpack: [
    'node_modules/@resvg/resvg-js*/**',
    'node_modules/@napi-rs/image*/**',
    'node_modules/sqlite3/**',
    'node_modules/clip-filepaths*/**',
    'node_modules/@vrchat-albums/exif-native*/**',
  ],
  publish: [
    {
      provider: 'github',
      owner: 'tktcorporation',
      repo: 'vrchat-albums',
      releaseType:
        process.env.NOT_DRAFT_RELEASE === 'true' ? 'release' : 'draft',
    },
  ],
  win: {
    target: 'nsis',
    icon: 'assets/icon-win.png',
  },
  linux: {
    target: 'AppImage',
    icon: 'assets/icon-linux.png',
  },
  mac: {
    target: 'dmg',
    identity: null,
    icon: 'assets/icon-mac.png',
  },
};

module.exports = config;
