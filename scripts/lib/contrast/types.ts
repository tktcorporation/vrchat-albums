/**
 * lint-contrast で使用する共有型定義。
 *
 * ライフサイクル:
 * 1. collectJsxStacks が JsxStack を生成
 * 2. classify が Resolution を付与
 * 3. resolveTailwind + composite + evaluateContrast が ContrastIssue を生成
 */

/** sRGB 色空間の RGBA 値。r/g/b は 0-1、a (alpha) は 0-1。 */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** CSS テーマモード。Tailwind の darkMode: 'class' に対応。 */
export type Theme = 'light' | 'dark';

/**
 * JSX className 属性の1つの評価分岐を表すクラス配列。
 *
 * cn(cond && 'bg-red', 'bg-blue') のような動的分岐がある場合、
 * 各分岐を別 ClassCandidate として記録する。
 */
export interface ClassCandidate {
  /** className 属性の1つの評価分岐を表すクラス配列 */
  classes: string[];
  /** 分岐条件 (cn/clsx の短絡評価など) のサマリ。報告時の説明用 */
  branchLabel?: string;
}

/**
 * JSX 要素の背景色スタックとテキスト候補を表す。
 *
 * collectJsxStacks が親→子の再帰下降で構築する。
 * bgStack は外側から内側の順で積まれる。
 */
export interface JsxStack {
  file: string;
  line: number;
  column: number;
  /** 親ノードから辿った bg クラスのスタック (外→内) */
  bgStack: ClassCandidate[];
  /** この要素自身の text クラス候補 */
  textCandidates: ClassCandidate[];
  /** 報告時に表示する JSX タグ名 */
  elementName: string;
}

/**
 * classifyStack の判定結果。
 *
 * Strategy B (Warn-on-unknown) の核心:
 * - resolvable: 全候補が静的に解決できる → コントラスト計算してエラーチェック
 * - unknown: 一部解決不能 → warning を出すだけでエラーにしない
 * - skip: 明らかに静的解析対象外 → 何も出さない
 */
export type Resolution =
  | { kind: 'resolvable'; themes: Record<Theme, { bg: Rgba; fg: Rgba }> }
  | { kind: 'unknown'; reason: string }
  | { kind: 'skip'; reason: string };

/**
 * コントラスト違反の報告エントリ。
 *
 * severity が 'error' の場合は exit 1 につながる。
 * 'warning' は CI を fail させない (Strategy B)。
 */
export interface ContrastIssue {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  theme: Theme | 'both';
  ratio?: number;
  message: string;
}
