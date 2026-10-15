/**
 * docs ライフサイクル lint の設定スキーマと、パス → lifecycle の解決ロジック。
 *
 * 設定を JSON ファイルに外出しする理由: lint 本体は ziku 経由で他リポジトリへ
 * 配布するが、「どのディレクトリが使い捨てか」はリポジトリごとに違う。実装と
 * ポリシーを分離しておけば、配布側は設定ファイルだけを書けば導入できる。
 *
 * JSON にコメントが書けない代わりに各ポリシーへ `why` を必須で持たせている。
 * 閾値やパス割り当ての WHY は設定ファイル自身が SSOT（`.claude/rules/doc-placement.md`）。
 */

import { z } from 'zod';
import { matchesAnyGlob } from './glob.ts';

/**
 * ドキュメントの寿命の種別。
 *
 * - `ephemeral`: 実装が終われば消える使い捨てのメモ（plan / spec）。短い閾値で見直しを強制する
 * - `durable`: 長期保持する WHY 集約ドキュメント。長い閾値で定期的な棚卸しだけ促す
 * - `generated`: コードから自動生成される doc。鮮度は生成チェックが担保するので対象外
 */
export const lifecycleSchema = z.enum(['ephemeral', 'durable', 'generated']);
export type Lifecycle = z.infer<typeof lifecycleSchema>;

const policySchema = z.strictObject({
  paths: z.array(z.string().min(1)).min(1),
  lifecycle: lifecycleSchema,
  /** このパス群をこの lifecycle に割り当てる理由。レビュー時に判断根拠を読めるようにする */
  why: z.string().min(1),
});
export type DocsLifecyclePolicy = z.infer<typeof policySchema>;

/**
 * 未知のキーを弾く（strict）理由: 既定値を持つ項目のキー名を書き間違えると、
 * 黙って既定値が使われる。`referencePrefixes` を打ち間違えれば参照残骸の検知が
 * `[]` で無効になり、`policies` を打ち間違えれば全 doc が defaultLifecycle 扱いになる。
 * どちらも「チェックが通った」という結果だけが残り、検知が弱まったことに気づけない。
 * この設定は ziku 配布先で書き換える前提なので、打ち間違いは失敗として見せる。
 */
export const configSchema = z.strictObject({
  /** 鮮度・リンクチェックの対象にする glob。ここにマッチしない .md は一切見ない */
  scan: z.array(z.string().min(1)).min(1),
  ignore: z.array(z.string().min(1)).default([]),
  /** lifecycle 別の stale 判定閾値（最終コミットからの経過日数） */
  staleDays: z.strictObject({
    ephemeral: z.number().int().positive(),
    durable: z.number().int().positive(),
  }),
  /** scan 対象だがどの policy にもマッチしなかった doc に適用する lifecycle */
  defaultLifecycle: lifecycleSchema.default('durable'),
  /** 先にマッチした policy が優先される（配列の順序が優先順位） */
  policies: z.array(policySchema).default([]),
  /**
   * リポジトリ全文検索で「doc への参照」と見なすパスの接頭辞（例: `docs/`）。
   * 削除済み doc を指したままの参照を検知し、参照元のある doc を棚卸し時に識別する。
   */
  referencePrefixes: z.array(z.string().min(1)).default([]),
  /**
   * 参照チェックから除外する「参照元」ファイルの glob。
   * lint 自身のテストのように、実在しない doc パスを意図的に書くファイルを外す。
   */
  referenceIgnoreFrom: z.array(z.string().min(1)).default([]),
});
export type DocsLifecycleConfig = z.infer<typeof configSchema>;

/**
 * 設定を検証する。不正なら、どのキーが問題かを並べた例外を投げる
 * （設定を直さない限りチェックは働かないので、呼び出し側に選択肢は無い）。
 */
export function parseConfig(raw: unknown): DocsLifecycleConfig {
  const parsed = configSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const detail = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`docs ライフサイクル設定が不正です:\n${detail}`, { cause: parsed.error });
}

/**
 * scan / ignore の glob に照らして、この doc がチェック対象かを判定する。
 */
export function isScanned(path: string, config: DocsLifecycleConfig): boolean {
  if (matchesAnyGlob(path, config.ignore)) return false;
  return matchesAnyGlob(path, config.scan);
}

/**
 * doc のパスから lifecycle を解決する。frontmatter の宣言はここでは見ない
 * （呼び出し側が「パス由来の既定値」を frontmatter で上書きする）。
 */
export function resolveLifecycleByPath(path: string, config: DocsLifecycleConfig): Lifecycle {
  const matched = config.policies.find((policy) => matchesAnyGlob(path, policy.paths));
  return matched?.lifecycle ?? config.defaultLifecycle;
}

/**
 * lifecycle に対応する stale 閾値。`generated` は鮮度チェックの対象外なので null。
 */
export function staleDaysFor(lifecycle: Lifecycle, config: DocsLifecycleConfig): number | null {
  if (lifecycle === 'generated') return null;
  return config.staleDays[lifecycle];
}
