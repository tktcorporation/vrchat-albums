/**
 * アプリ外の URL を扱うときの許可判定（純粋関数）。
 *
 * 背景: `shell.openExternal` は渡された URL のスキームに関連付けられた
 * OS のハンドラをそのまま起動する。`file:` や `ms-settings:`、`smb:` などを
 * 素通しすると、レンダラーに入り込んだ文字列一つでローカル実行ファイルや
 * OS 設定画面、ネットワーク共有を開けてしまう。外部ブラウザへ渡す URL と
 * ウィンドウ内で遷移してよい URL を、ここで一箇所に集めて判定する。
 *
 * Electron に依存しないため、main プロセスの各所とテストから直接使える。
 *
 * @see electron/electronUtil.ts - ウィンドウのナビゲーション / window.open ガード
 * @see electron/module/electronUtil/service.ts - openUrlInDefaultBrowser
 */

import { posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Option } from 'effect';
import { match } from 'ts-pattern';

/**
 * 外部ブラウザで開いてよいスキーム。
 * アプリが開くリンク（VRChat のワールドページ、GitHub、ライセンス表記のリポジトリ）は
 * すべて https のため、それ以外は受け付けない。
 */
const ALLOWED_EXTERNAL_PROTOCOLS: ReadonlySet<string> = new Set(['https:']);

/** 外部で開けない理由 */
export type ExternalUrlRejection =
  | { type: 'MALFORMED_URL'; input: string }
  | { type: 'DISALLOWED_SCHEME'; input: string; protocol: string };

/** 外部で開けるかの判定結果。許可時は URL パーサーで正規化した href を返す */
export type ExternalUrlCheck =
  | { ok: true; url: string }
  | { ok: false; rejection: ExternalUrlRejection };

/** 解析済みの URL のスキームが外部ブラウザで開いてよいものかを判定する */
const checkParsedExternalUrl = (
  parsed: URL,
): { ok: true; url: string } | { ok: false; protocol: string } =>
  ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)
    ? { ok: true, url: parsed.href }
    : { ok: false, protocol: parsed.protocol };

/**
 * URL を外部ブラウザで開いてよいかを判定する。
 * スキームは WHATWG URL パーサーが小文字へ正規化するため、`HTTPS:` も https として扱う。
 */
export const checkExternalUrl = (input: string): ExternalUrlCheck => {
  if (!URL.canParse(input)) {
    return { ok: false, rejection: { type: 'MALFORMED_URL', input } };
  }
  const checked = checkParsedExternalUrl(new URL(input));
  return checked.ok
    ? checked
    : {
        ok: false,
        rejection: {
          type: 'DISALLOWED_SCHEME',
          input,
          protocol: checked.protocol,
        },
      };
};

/**
 * ウィンドウが読み込んでいるアプリ本体の位置。
 * 開発時は Vite dev server の origin、本番時は同梱した index.html のファイルパス。
 * `windows` は、ファイルパスを Windows の規則（ドライブレター・大文字小文字を区別しない）で
 * 比較するかどうか。
 */
export type AppEntry =
  | { kind: 'devServer'; origin: string }
  | { kind: 'file'; filePath: string; windows: boolean };

/** ナビゲーション要求に対する扱い */
export type NavigationDecision =
  | { action: 'allow' }
  | { action: 'openExternal'; url: string }
  | { action: 'block'; reason: NavigationBlockReason };

type NavigationBlockReason =
  | { type: 'MALFORMED_URL'; input: string }
  | { type: 'NOT_APP_AND_NOT_EXTERNAL'; input: string; protocol: string };

/** file URL をファイルパスへ変換する。パスとして表せない URL（ホスト付き等）は None */
const fileUrlToPath = (target: URL, windows: boolean): Option.Option<string> =>
  Option.liftThrowable(() => fileURLToPath(target, { windows }))();

/**
 * 遷移先がアプリ本体と同じ位置かを判定する。
 *
 * file URL は文字列のまま比べず、ファイルパスへ戻してから比べる。Chromium が報告する URL と
 * Node の pathToFileURL が作る URL は、ドライブレターの大文字小文字やパーセントエンコードの
 * 仕方が揃わないことがあり、同じファイルでも文字列は一致しないため。
 */
const isAppUrl = (target: URL, entry: AppEntry): boolean =>
  match(entry)
    .with({ kind: 'devServer' }, (e) => target.origin === e.origin)
    .with({ kind: 'file' }, (e) => {
      if (target.protocol !== 'file:') {
        return false;
      }
      const pathApi = e.windows ? win32 : posix;
      const normalize = (p: string) => {
        const normalized = pathApi.normalize(p);
        return e.windows ? normalized.toLowerCase() : normalized;
      };
      return Option.match(fileUrlToPath(target, e.windows), {
        onNone: () => false,
        onSome: (targetPath) => normalize(targetPath) === normalize(e.filePath),
      });
    })
    .exhaustive();

/**
 * ウィンドウ内のナビゲーション要求をどう扱うかを決める。
 *
 * - アプリ本体と同じ位置への遷移だけを許可する
 * - それ以外で外部ブラウザに渡せる URL は外部で開く（ウィンドウは遷移しない）
 * - どちらでもない URL は遷移も外部起動もしない
 */
export const decideNavigation = (
  input: string,
  entry: AppEntry,
): NavigationDecision => {
  if (!URL.canParse(input)) {
    return { action: 'block', reason: { type: 'MALFORMED_URL', input } };
  }
  const parsed = new URL(input);
  if (isAppUrl(parsed, entry)) {
    return { action: 'allow' };
  }
  const external = checkParsedExternalUrl(parsed);
  return external.ok
    ? { action: 'openExternal', url: external.url }
    : {
        action: 'block',
        reason: {
          type: 'NOT_APP_AND_NOT_EXTERNAL',
          input,
          protocol: external.protocol,
        },
      };
};
