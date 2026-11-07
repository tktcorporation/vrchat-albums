/**
 * 処理本体（electron/module/）が、アプリの殻から受け取る機能の型。
 *
 * 処理本体を utilityProcess で動かすと、`app`・`dialog`・`clipboard`・`shell`・
 * `Notification` は子プロセスから使えない（#897）。処理本体は Electron を直接触らず、
 * 殻が実装するこの型を通して OS の機能を使う。
 *
 * 値の受け渡し方は 2 種類に分けている。
 * - `HostInfo`: 起動後に変わらない値。起動時に 1 度だけ渡す
 * - `HostShell`: OS の操作。殻が別プロセスになると往復が要るので、すべて Promise を返す
 *
 * Electron の型（`OpenDialogReturnValue` など）は使わない。処理本体の型が
 * Electron に依存すると、別の殻（Electrobun・Tauri の sidecar 構成）へ移せなくなるため。
 */

/** OS が決めるディレクトリ。Electron の `app.getPath()` の値に対応する */
export interface HostPaths {
  /** 設定・DB・ログの保存先。例: `%APPDATA%\\VRChatAlbums` */
  readonly userData: string;
  readonly logs: string;
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
}

/** 処理本体が殻から受け取るもの全体 */
export interface Host {
  readonly info: HostInfo;
  readonly shell: HostShell;
}
