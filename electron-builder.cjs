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
  // 配布バイナリの起動オプションを固定する。既定のままだと、環境変数や起動引数を渡すだけで
  // 同じ署名済みバイナリを汎用の Node.js として動かしたり、デバッガを繋いだりできる。
  // アプリはどの機能も使わないため無効化する。
  // 次の fuse は理由があって既定値のままにする（ここに書かない fuse も既定値のまま）:
  // - grantFileProtocolExtraPrivileges: 画面を file:// から読み込んでいるため
  // - enableEmbeddedAsarIntegrityValidation: 整合性の検証に失敗するとアプリが起動しなくなる。
  //   macOS / Windows のパッケージで起動を確かめてから有効にする
  // - enableCookieEncryption: アプリは Cookie を使わないため
  electronFuses: {
    // ELECTRON_RUN_AS_NODE=1 でバイナリを Node.js として起動できなくする
    runAsNode: false,
    // NODE_OPTIONS / NODE_EXTRA_CA_CERTS で起動時の Node.js の挙動を変えられなくする
    enableNodeOptionsEnvironmentVariable: false,
    // --inspect 系の引数と SIGUSR1 でメインプロセスにデバッガを繋げなくする
    enableNodeCliInspectArguments: false,
    // resources/app.asar 以外（展開した app ディレクトリ等）からアプリのコードを読まない
    onlyLoadAppFromAsar: true,
    // fuse の書き換えで macOS の ad-hoc 署名が無効になる。mac は identity: null で
    // 署名しないため、ここで ad-hoc 署名を付け直さないと Apple Silicon で起動できない
    resetAdHocDarwinSignature: true,
  },
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
