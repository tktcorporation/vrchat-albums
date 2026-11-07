/**
 * 処理本体（electron/module/）が、アプリの殻から受け取る機能の型。
 *
 * 処理本体を utilityProcess で動かすと、`app`・`dialog`・`clipboard`・`shell`・
 * `Notification` は子プロセスから使えない。処理本体は Electron を直接触らず、
 * 殻が実装するこの型を通して OS の機能を使う。
 *
 * 値の受け渡し方は 3 種類に分けている。
 * - `HostInfo`: 起動後に変わらない値。起動時に 1 度だけ渡す
 * - `HostShell`: OS とウィンドウの操作。殻が別プロセスになると往復が要るので、すべて Promise を返す
 * - `HostUpdater`: アプリの自動更新。更新の状態は殻が持ち、処理本体は問い合わせて読む
 *
 * Electron や electron-updater の型（`OpenDialogReturnValue`・`UpdateCheckResult` など）は使わない。
 * 処理本体の型がそれらに依存すると、別の殻（Electrobun・Tauri の sidecar 構成）へ移せなくなるため。
 * どの型も、プロセスの間で受け渡せる素のデータだけで組む。
 */

/** OS が決めるディレクトリ。Electron の `app.getPath()` の値に対応する */
export interface HostPaths {
  /** 設定・DB・ログの保存先。例: `%APPDATA%\\VRChatAlbums` */
  readonly userData: string;
  readonly downloads: string;
  readonly pictures: string;
  readonly temp: string;
}

/** 起動後に変わらない、殻についての情報 */
export interface HostInfo {
  readonly paths: HostPaths;
  readonly appVersion: string;
  /** 配布用にパッケージされた状態で動いているか。開発時は false */
  readonly isPackaged: boolean;
  /**
   * 同梱リソース（フォントなど）を置くディレクトリ。
   * パッケージ時は `process.resourcesPath`、開発時は `electron/resources`。
   */
  readonly resourcesPath: string;
}

export type OpenDialogProperty =
  | 'openDirectory'
  | 'openFile'
  | 'multiSelections';

export type OpenDialogResult =
  | { readonly canceled: true }
  | { readonly canceled: false; readonly filePaths: readonly string[] };

export interface SaveDialogOptions {
  readonly defaultPath: string;
  readonly filters: readonly {
    readonly name: string;
    readonly extensions: readonly string[];
  }[];
}

export type SaveDialogResult =
  | { readonly canceled: true }
  | { readonly canceled: false; readonly filePath: string };

/** 殻が実装する OS の操作 */
export interface HostShell {
  /**
   * OS の既定のアプリでパスを開く。
   * 失敗時は OS が返したエラーメッセージを、成功時は空文字列を返す（Electron の `shell.openPath` と同じ）。
   */
  openPath(targetPath: string): Promise<string>;
  /** 既定のブラウザで URL を開く。URL の許可判定は呼び出し側が済ませてから渡す */
  openExternal(url: string): Promise<void>;
  showOpenDialog(
    properties: readonly OpenDialogProperty[],
  ): Promise<OpenDialogResult>;
  showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogResult>;
  /** PNG ファイルを読み、画像としてクリップボードへ書き込む */
  writeClipboardImageFromPngFile(pngPath: string): Promise<void>;
  writeClipboardText(text: string): Promise<void>;
  /** OS の通知を表示する。クリック時の動作は持たない */
  notify(notification: {
    readonly title: string;
    readonly body: string;
  }): Promise<void>;
  /** OS へのログイン時にアプリを起動する設定 */
  getOpenAtLogin(): Promise<boolean>;
  setOpenAtLogin(openAtLogin: boolean): Promise<void>;
  /** メインウィンドウを再読み込みする。ウィンドウが無ければ何もしない */
  reloadWindow(): Promise<void>;
  /**
   * 利用者が規約に同意したことを殻へ知らせる。
   *
   * 同意の保存は処理本体が済ませてから呼ぶ。殻は同意を前提にする自分の機能
   * （エラー監視の送信の開始）をここで有効にする。何を有効にするかは殻が決める。
   */
  onTermsAccepted(): Promise<void>;
}

/** 更新の配布元が告げた新しい版の情報 */
export interface HostUpdateInfo {
  readonly version: string;
  readonly releaseDate: string;
  readonly releaseName: string | null;
  /** 配布元によって、1 つの文字列か版ごとの注記の一覧か、どちらかで届く */
  readonly releaseNotes:
    | string
    | readonly { readonly version: string; readonly note: string | null }[]
    | null;
}

/** 更新の確認の結果 */
export interface HostUpdateCheckResult {
  /** 配布元の版が、動いている版より新しいと更新の仕組みが判定したか */
  readonly isUpdateAvailable: boolean;
  readonly updateInfo: HostUpdateInfo;
}

/** 殻が持つ更新の状態 */
export interface HostUpdateStatus {
  /** 新しい版のダウンロードが済み、再起動すれば入れ替えられるか */
  readonly updateDownloaded: boolean;
  /** 配布元で見つかった新しい版。まだ見つかっていなければ null */
  readonly availableVersion: string | null;
  /** このプラットフォームで更新を自動でダウンロード・インストールできるか */
  readonly canAutoInstall: boolean;
}

/** 殻が実装するアプリの自動更新 */
export interface HostUpdater {
  /**
   * 配布元に新しい版があるかを確かめる。自動インストールできる環境では、見つかった版のダウンロードも始まる。
   * 更新の仕組みが動かない環境（開発時など）では null を返す。確認に失敗すると reject する。
   */
  checkForUpdates(): Promise<HostUpdateCheckResult | null>;
  /** アプリを終了し、ダウンロード済みの版を入れる */
  quitAndInstall(): Promise<void>;
  getStatus(): Promise<HostUpdateStatus>;
}

/** 処理本体が殻から受け取るもの全体 */
export interface Host {
  readonly info: HostInfo;
  readonly shell: HostShell;
  readonly updater: HostUpdater;
}
