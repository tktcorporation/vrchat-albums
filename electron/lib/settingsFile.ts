/**
 * 設定ファイル（electron-store の JSON）の名前と、main プロセスが読むための読み出し。
 *
 * 設定ファイルを書くのは処理本体（`electron/module/settingStore.ts`）だけにする。electron-store は
 * 書き込みのたびにファイル全体を置き換えるので、main からも書くと、片方の更新がもう片方の書き込みで消える。
 * main は起動直後から処理本体の準備より先に値を要る（ウィンドウの位置、エラー監視の送信の判定）ので、
 * ファイルを直接読むだけにする。main が値を変えたいときは処理本体へ頼む（`setWindowBounds`）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { Effect } from 'effect';
import { match } from 'ts-pattern';
import { z } from 'zod';

import { logger } from './logger';

type TestPlaywrightStoreName = `test-playwright-settings-${string}`;
export type SettingStoreName =
  | 'v0-settings'
  | 'test-settings'
  | TestPlaywrightStoreName;

/**
 * 起動の環境に応じた設定ファイルの名前。
 * Playwright のテストは実行ごとに別のファイルを使い、利用者の設定を汚さない。
 */
export const resolveSettingStoreName = (
  env: NodeJS.ProcessEnv = process.env,
): SettingStoreName =>
  env.PLAYWRIGHT_TEST === 'true' && env.PLAYWRIGHT_STORE_HASH
    ? `test-playwright-settings-${env.PLAYWRIGHT_STORE_HASH}`
    : 'v0-settings';

/** electron-store が `cwd` と `name` から決めるファイルの場所（拡張子は既定の json） */
export const settingStoreFilePath = (
  userDataDir: string,
  name: SettingStoreName,
): string => path.join(userDataDir, `${name}.json`);

const WindowBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export type WindowBounds = z.infer<typeof WindowBoundsSchema>;

/**
 * main が読む値だけのスキーマ。項目ごとに検証し、壊れた項目は「未設定」として扱う。
 * 1 つの項目が壊れているだけで、他の項目まで読めなくしないため。
 */
const SettingsSnapshotSchema = z.object({
  termsAccepted: z.boolean().optional().catch(undefined),
  termsVersion: z.string().optional().catch(undefined),
  backgroundFileCreateFlag: z.boolean().optional().catch(undefined),
  windowBounds: WindowBoundsSchema.optional().catch(undefined),
});

/** main が読む設定。未設定の項目は、処理本体の `settingStore` と同じ既定値に倒す */
export interface SettingsSnapshot {
  readonly termsAccepted: boolean;
  readonly termsVersion: string;
  readonly backgroundFileCreateFlag: boolean;
  readonly windowBounds: WindowBounds | undefined;
}

const EMPTY_SNAPSHOT: SettingsSnapshot = {
  termsAccepted: false,
  termsVersion: '',
  backgroundFileCreateFlag: false,
  windowBounds: undefined,
};

type ReadFailure =
  | { readonly type: 'NOT_FOUND' }
  | { readonly type: 'UNREADABLE'; readonly error: unknown };

/**
 * 設定ファイルを読み、main が使う値を返す。
 *
 * 読むたびにファイルを開く。値は処理本体がいつでも書き換えるので、手元に覚えておくと古くなる。
 * ファイルが無い（初回起動）・JSON として読めない・型が違うときは、未設定として既定値を返す。
 * electron-store は一時ファイルへ書いてから置き換えるので、書き込みの途中の内容を読むことはない。
 */
export const readSettingsSnapshot = (filePath: string): SettingsSnapshot => {
  const read = Effect.try({
    try: () => fs.readFileSync(filePath, 'utf8'),
    catch: (error): ReadFailure =>
      match(error)
        .with({ code: 'ENOENT' }, () => ({ type: 'NOT_FOUND' as const }))
        .otherwise((e) => ({ type: 'UNREADABLE' as const, error: e })),
  }).pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: (): unknown => JSON.parse(text),
        catch: (error): ReadFailure => ({ type: 'UNREADABLE', error }),
      }),
    ),
  );
  const parsed = Effect.runSync(
    read.pipe(
      Effect.catch((failure) =>
        Effect.sync((): unknown => {
          match(failure)
            .with({ type: 'NOT_FOUND' }, () => {
              // 初回起動。処理本体が最初に書くまでファイルは無い
            })
            .with({ type: 'UNREADABLE' }, ({ error }) => {
              logger.warn({
                message: `設定ファイルを読めないため、既定値で続けます: ${filePath}`,
                stack:
                  error instanceof Error ? error : new Error(String(error)),
              });
            })
            .exhaustive();
          return {};
        }),
      ),
    ),
  );
  const result = SettingsSnapshotSchema.safeParse(parsed);
  if (!result.success) {
    return EMPTY_SNAPSHOT;
  }
  return {
    termsAccepted: result.data.termsAccepted ?? EMPTY_SNAPSHOT.termsAccepted,
    termsVersion: result.data.termsVersion ?? EMPTY_SNAPSHOT.termsVersion,
    backgroundFileCreateFlag:
      result.data.backgroundFileCreateFlag ??
      EMPTY_SNAPSHOT.backgroundFileCreateFlag,
    windowBounds: result.data.windowBounds,
  };
};
