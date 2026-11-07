import type { Host } from './types';

export type * from './types';

/**
 * 処理本体が使う殻の機能の登録先。
 *
 * 殻の実装は `electron/registerElectronHost.ts` が `registerHost()` で登録し、
 * 処理本体は `getHost()` で取り出す。`electron/api.ts` などはモジュールの読み込み時に
 * `getHost()` を呼ぶため、`electron/index.ts` はこの登録モジュールを最初に import する
 * （順序は ast-grep の `register-electron-host-first` が検出する）。
 * テストは `vitest.setup.ts` で `createTestHost()` を登録する。
 *
 * Effect の Layer ではなくモジュール単位の登録にしているのは、electron/ の
 * サービスがどれも Context を使っておらず、Layer にすると全サービスの
 * Effect の型に依存を足す改修になるため。
 */
let registeredHost: Host | null = null;

export const registerHost = (host: Host): void => {
  registeredHost = host;
};

/**
 * 登録済みの殻の機能を返す。
 *
 * 未登録のまま呼ばれるのは、殻が登録する前に処理本体が動いたという
 * 起動順序の不具合なので、既定値で続けずに投げて Sentry に届ける。
 * 既定値で続けると、本番で一時ディレクトリへ DB やログを書く状態に気づけない。
 */
export const getHost = (): Host => {
  if (registeredHost === null) {
    throw new Error(
      'Host is not registered. registerHost() must run before any service uses OS features.',
    );
  }
  return registeredHost;
};
