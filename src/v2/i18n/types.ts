import type { RunStage } from '../../../electron/module/initProgress/schema';

export type Language = 'en' | 'ja';

/**
 * 起動画面の見出しを選ぶための起動種別。
 * `pending` は DB の準備中で起動種別がまだ分からない間、`fullResync` は初回ではないが
 * 写真フォルダの変更などで全件を読み直す起動。
 */
export type StartupLaunchVariant =
  | 'pending'
  | 'firstLaunch'
  | 'fullResync'
  | 'incremental';

// 翻訳キーのパスを生成するための型
type RecursiveKeyOf<TObj> = {
  [TKey in keyof TObj & (string | number)]: TObj[TKey] extends Record<
    string,
    unknown
  >
    ? `${TKey}` | `${TKey}.${RecursiveKeyOf<TObj[TKey]>}`
    : `${TKey}`;
}[keyof TObj & (string | number)];

// 翻訳キーの型
export type TranslationKey = RecursiveKeyOf<Translations>;

export interface Translations {
  common: {
    settings: string;
    close: string;
    submit: string;
    loading: string;
    noPhotosFound: string;
    photos: string;
    refresh: string;
    search: {
      placeholder: string;
      loading: string;
      noSuggestions: string;
      loadingFrequentItems: string;
      frequentItems: string;
    };
    errorBoundary: {
      title: string;
      retryHint: string;
      retry: string;
    };
    reportBug: string;
    toast: {
      settingsDeleted: string;
      allSettingsDeleted: string;
      logFilePathSet: string;
    };
    contextMenu: {
      copyPhotoData: string;
      selectPhoto: string;
      openInPhotoApp: string;
      showInExplorer: string;
      shareImage: string;
      downloadImage: string;
    };
    share: string;
    copy: string;
    delete: string;
  };
  debug: {
    sqliteConsole: {
      title: string;
      queryLabel: string;
      shortcut: string;
      placeholder: string;
      execute: string;
      resultLabel: string;
      noResult: string;
      enableDebugLog: string;
      throwErrorButton: string;
      errorThrownSuccess: string;
    };
  };
  locationHeader: {
    ungrouped: string;
    photoCount: string;
    share: string;
    copyToClipboard: string;
    downloadImage: string;
    showAllPlayers: string;
    worldInfoDeleted: string;
    otherPlayers: string;
    createdBy: string;
    instanceId: string;
    clickToCopy: string;
    copied: string;
    noPlayerInfo: string;
    previewGenerationFailed: string;
  };
  settings: {
    tabs: {
      dataSource: string;
      theme: string;
      system: string;
      info: string;
      license: string;
    };
    system: {
      title: string;
      startupLaunch: string;
      startupDescription: string;
      startupError: string;
      startupSuccess: string;
      backgroundUpdate: string;
      backgroundDescription: string;
      updateInterval: string;
      updateIntervalDescription: string;
      notifications: string;
      notificationsDescription: string;
      worldJoinImageGeneration: string;
      worldJoinImageGenerationDescription: string;
      interval: {
        '5min': string;
        '15min': string;
        '30min': string;
        '1hour': string;
      };
    };
    theme: {
      title: string;
      system: string;
      dark: string;
      light: string;
    };
    paths: {
      useDemo: string;
      useLocal: string;
      photoDirectory: string;
      logFile: string;
      browse: string;
      extraDirectoriesLabel: string;
      addExtraDirectory: string;
      addExtraDirectoryButton: string;
      removeExtraDirectory: string;
      validate: string;
      validating: string;
      description: string;
      refreshIndexLabel: string;
      logFormat: {
        title: string;
        description: string;
      };
    };
    dataImport: {
      historyDescription: string;
    };
    info: {
      title: string;
      version: string;
      name: string;
      dependencies: string;
      openLog: string;
      update: {
        checkForUpdates: string;
        checking: string;
        available: string;
        upToDate: string;
        downloaded: string;
        installAndRestart: string;
        checkFailed: string;
      };
      licenses: {
        title: string;
        viewLicense: string;
        suffix: string;
      };
    };
  };
  photoModal: {
    visitedWith: string;
    tags: string;
    resolution: string;
    lastVisited: string;
    recommendedSeason: string;
  };
  initProgress: {
    /** 起動・同期処理の各ステージの表示名 */
    stage: Record<RunStage, string>;
    /** 起動画面（撮影月ごとの写真を年ごとの輪に並べた図と件数で、読み込みの進み具合を見せる画面） */
    timeline: {
      /** 見出し。起動種別ごと（`pending` は起動種別の判定前） */
      headline: Record<StartupLaunchVariant, string>;
      /** 累計を 1 文にしたもの。`{photos}` `{worlds}` `{people}` に件数が入る */
      summary: string;
      /** 読み込みが完了したときの表示 */
      ready: string;
      /** 進捗バーの読み上げ名 */
      progressLabel: string;
      /** 年ごとの輪の図の読み上げ名 */
      chartLabel: string;
      /** 件数の説明。`{current}` `{total}` `{month}` に値が入る */
      detail: {
        photosInMonth: string;
        photos: string;
        files: string;
        logs: string;
      };
    };
  };
  pullToRefresh: {
    pull: string;
    release: string;
    refreshing: string;
    checking: string;
  };
  yearlyVisitors: string;
  terms: {
    title: string;
    updateTitle: string;
    accept: string;
    saveFailed: string;
    loadFailed: string;
    retry: string;
  };
  migration: {
    title: string;
    description: string;
    items: {
      database: string;
      logStore: string;
      settings: string;
    };
    labels: {
      oldApp: string;
      newApp: string;
      dataToMigrate: string;
      dataDescription: string;
      notes: string;
      note1: string;
      note2: string;
    };
    buttons: {
      skip: string;
      migrate: string;
      migrating: string;
    };
    toast: {
      success: string;
      successDetail: string;
      error: string;
    };
  };
}
