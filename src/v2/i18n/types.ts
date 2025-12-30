export type Language = 'en' | 'ja';

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
    };
    toast: {
      settingsDeleted: string;
      allSettingsDeleted: string;
      logFilePathSet: string;
    };
    contextMenu: {
      copyPhotoData: string;
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
      addExtraDirectory: string;
      removeExtraDirectory: string;
      validate: string;
      validating: string;
      logFormat: {
        title: string;
        description: string;
      };
    };
    info: {
      title: string;
      version: string;
      name: string;
      dependencies: string;
      openLog: string;
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
