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
    // renderWorker.cjs は worker_threads の Worker としてファイルパスから
    // 読み込まれる (workerClient.ts)。asar 内スクリプトでの worker_threads 起動が
    // 確実に動作する保証がないため、実ファイルシステムパスから読めるよう
    // main/ ディレクトリ全体を unpack する (ADR-005)。
    'main/**',
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
