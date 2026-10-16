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

/**
 * URL を外部ブラウザで開いてよいかを判定する。
 * スキームは WHATWG URL パーサーが小文字へ正規化するため、`HTTPS:` も https として扱う。
 */
export const checkExternalUrl = (input: string): ExternalUrlCheck => {
  if (!URL.canParse(input)) {
    return { ok: false, rejection: { type: 'MALFORMED_URL', input } };
  }
  const parsed = new URL(input);
  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      rejection: {
        type: 'DISALLOWED_SCHEME',
        input,
        protocol: parsed.protocol,
      },
    };
  }
  return { ok: true, url: parsed.href };
};

/**
 * ウィンドウが読み込んでいるアプリ本体の位置。
 * 開発時は Vite dev server の origin、本番時は同梱した index.html の file URL。
 */
export type AppEntry =
  | { kind: 'devServer'; origin: string }
  | { kind: 'file'; pathname: string };

/** ナビゲーション要求に対する扱い */
export type NavigationDecision =
  | { action: 'allow' }
  | { action: 'openExternal'; url: string }
  | { action: 'block'; reason: NavigationBlockReason };

type NavigationBlockReason =
  | { type: 'MALFORMED_URL'; input: string }
  | { type: 'NOT_APP_AND_NOT_EXTERNAL'; input: string; protocol: string };

/**
 * 遷移先がアプリ本体と同じ位置かを判定する。
 * file URL の origin は仕様上 "null" になり比較に使えないため、パスで比較する。
 */
const isAppUrl = (target: URL, entry: AppEntry): boolean =>
  match(entry)
    .with({ kind: 'devServer' }, (e) => target.origin === e.origin)
    .with(
      { kind: 'file' },
      (e) => target.protocol === 'file:' && target.pathname === e.pathname,
    )
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
  if (isAppUrl(new URL(input), entry)) {
    return { action: 'allow' };
  }
  const external = checkExternalUrl(input);
  if (external.ok) {
    return { action: 'openExternal', url: external.url };
  }
  return match(external.rejection)
    .with(
      { type: 'MALFORMED_URL' },
      (r): NavigationDecision => ({
        action: 'block',
        reason: { type: 'MALFORMED_URL', input: r.input },
      }),
    )
    .with(
      { type: 'DISALLOWED_SCHEME' },
      (r): NavigationDecision => ({
        action: 'block',
        reason: {
          type: 'NOT_APP_AND_NOT_EXTERNAL',
          input: r.input,
          protocol: r.protocol,
        },
      }),
    )
    .exhaustive();
};
