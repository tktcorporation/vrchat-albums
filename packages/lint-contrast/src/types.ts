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
  /**
   * 分岐識別子。同じ branchId を持つ bg/text 候補は「同じ runtime 分岐」に属する。
   *
   * classify の組合せ列挙で、異なる branchId 同士の bg × text 組合せは除外される。
   * これにより cn(cond ? 'bg-black text-white' : 'bg-white text-black') のような
   * 条件分岐で bg と text のペア結合が保たれ、到達不能な組合せ (偽陽性/偽陰性) を防ぐ。
   *
   * - undefined: 「無条件」。全ての branchId と互換 (常に適用される)
   * - 文字列: 特定の分岐に属する候補。同じ branchId を持つ bg/text のみ組合せ対象
   *
   * 例: cn(cond ? 'bg-black text-white' : 'bg-white text-black')
   *   bgCandidate { classes: ['bg-black'], branchId: 'cn@42:0:c' }  (consequent)
   *   bgCandidate { classes: ['bg-white'], branchId: 'cn@42:0:a' }  (alternate)
   *   textCandidate { classes: ['text-white'], branchId: 'cn@42:0:c' }
   *   textCandidate { classes: ['text-black'], branchId: 'cn@42:0:a' }
   *   → 有効組合せ: (bg-black, text-white), (bg-white, text-black) のみ
   *
   * branchId の形式: "cn@<callSite>:<argIndex>:<suffix>"
   * callSite は cn() 呼び出しの AST start offset。
   * 異なる cn() 呼び出し間で同じ argIndex を持つ branchId が衝突しないよう
   * callSite を prefix として含める (F1 修正)。
   */
  branchId?: string;
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
  /**
   * 親ノードから辿った bg クラスの階層配列 (外→内)。
   *
   * 外層 (bgStack[i]) は DOM 階層の 1 層を表す。
   * 内層 (bgStack[i][j]) はその層での alternative 候補群 (排他的選択肢) を表す。
   *
   * enumerateCombinations は各層から 1 つずつ候補を選ぶ直積で
   * 具体的な合成スタックを生成する。これにより cn(cond ? 'bg-black' : 'bg-white') のような
   * 排他分岐が「両方同時適用」ではなく「どちらか一方を選ぶ」として正しく評価される。
   *
   * 例:
   * ```
   * bgStack: [
   *   [{ classes: ['bg-red'], branchId: undefined }],          // 層1: 祖父の bg (無条件)
   *   [{ classes: ['bg-black'], branchId: 'cn@42:0:c' },        // 層2: 親の bg (条件分岐)
   *    { classes: ['bg-white'], branchId: 'cn@42:0:a' }],
   * ]
   * ```
   */
  bgStack: ClassCandidate[][];
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
