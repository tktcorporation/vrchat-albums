/**
 * Strategy B (Warn-on-unknown) 分類モジュール。
 *
 * JsxStack を受け取り、静的解析の深度に応じて
 * resolvable / unknown / skip のいずれかを返す。
 *
 * 設計判断の詳細:
 * issues/20260417-design-system-contrast-lint.md の
 * 「Classification Rules (決定版)」セクションを参照。
 */

import { match, P } from 'ts-pattern';

import { compositeOver } from './composite.js';
import { wcagContrastRatio } from './evaluateContrast.js';
import { getBaseBackground } from './getBaseBackground.js';
import { resolveClass } from './resolveTailwind.js';
import type {
  ClassCandidate,
  JsxStack,
  Resolution,
  Rgba,
  Theme,
} from './types.js';

/**
 * あるクラスが指定されたテーマに適用されるかを判定する。
 *
 * - `dark:` プレフィックスを持つクラスは `dark` テーマのときのみ適用される
 * - プレフィックスなしのクラスは常に適用される
 * - 将来の `light:` や `hover:` 等のバリアントへの拡張を想定し、
 *   プレフィックスと対応テーマのマップで実装している
 *
 * Phase 1 では `dark:` のみをサポートし、その他のバリアント (`hover:`, `focus:` 等) は
 * 常に適用とみなす（resolveClass 側で null が返るため実質スキップされる）。
 *
 * @param cls - Tailwind クラス名 (例: "dark:bg-gray-900", "bg-white")
 * @param theme - 評価中のテーマ ('light' | 'dark')
 * @returns クラスがこのテーマで適用されるなら true
 */
function isApplicableForTheme(cls: string, theme: Theme): boolean {
  // バリアントプレフィックスと、適用されるテーマのマッピング
  // 将来の拡張: 'light:', 'md:', 'hover:' 等を追加する場合はここに追記する
  const themeVariants: Record<string, Theme> = {
    'dark:': 'dark',
  };

  for (const [prefix, applicableTheme] of Object.entries(themeVariants)) {
    if (cls.startsWith(prefix)) {
      return theme === applicableTheme;
    }
  }

  // プレフィックスなし → 全テーマで適用
  return true;
}

/**
 * 組合せ数が爆発するときのデフォルト上限。Rule 6/7 の分岐閾値。
 * CLI の --max-combinations オプションで上書き可能。
 */
const DEFAULT_COMBINATION_LIMIT = 32;

/**
 * bgStack の各 ClassCandidate 配列の直積 × textCandidates を列挙する。
 *
 * bgStack の各インデックスから1つずつ ClassCandidate を選び、
 * textCandidates からも1つ選んだ全組合せを返す。
 *
 * @param bgStack - 背景候補のスタック (外→内の順)
 * @param textCandidates - テキスト候補の配列
 * @returns 全組合せの配列。各要素は { bgCandidates, textCandidate }
 */
function enumerateCombinations(
  bgStack: ClassCandidate[],
  textCandidates: ClassCandidate[],
): { bgCandidates: ClassCandidate[]; textCandidate: ClassCandidate }[] {
  // Build cartesian product of bgStack selections
  // Each bgStack element contributes exactly one ClassCandidate per combination
  // (For Phase 1 we treat each element in bgStack as already being 1 candidate —
  // the bgStack is a flat array not a 2D array of alternatives.)
  // So the "product" is simply: pick one textCandidate, use all bgStack entries.
  const results: {
    bgCandidates: ClassCandidate[];
    textCandidate: ClassCandidate;
  }[] = [];
  for (const textCandidate of textCandidates) {
    results.push({ bgCandidates: bgStack, textCandidate });
  }
  return results;
}

/**
 * 組合せ数を計算する。
 *
 * bgStack の各要素は ClassCandidate を1つとして扱い、
 * textCandidates の数だけ組合せが生まれる。
 * 将来的に bgStack が 2D になった場合はここを変更する。
 */
function countCombinations(
  bgStack: ClassCandidate[],
  textCandidates: ClassCandidate[],
): number {
  // Phase 1: bgStack は flat な候補リスト（各要素 = 1候補、選択肢ではない）。
  // 実際の組合せ数は textCandidates の数だけ。bgStack は全要素を使って合成するので
  // 「bgStack のどれか1つを選ぶ」というバリアントは存在しない。
  // bgStack.length を因子に含めると組合せ数を過大計上し、combinatorial-explosion 誤検知が起きる。
  if (bgStack.length === 0) {
    return 0;
  }
  return textCandidates.length;
}

/**
 * 単一テーマに対して bg スタックと fg を解決し、コントラスト比を返す。
 *
 * @returns { bg, fg, ratio } または null (解決不能)
 */
function resolveForTheme(
  bgCandidates: ClassCandidate[],
  textCandidate: ClassCandidate,
  theme: Theme,
  cssVars: Record<Theme, Record<string, Rgba>>,
  base: Rgba,
): { bg: Rgba; fg: Rgba; ratio: number } | null {
  // Resolve each bg candidate using CSS cascade semantics:
  // 同一 ClassCandidate 内では最後に出現した適用可能な bg クラスを採用する。
  // (CSS では複数の background-color 宣言が並ぶと最後の宣言が有効になるため)
  // 例: "bg-white dark:bg-black/50" を dark モードで評価すると dark:bg-black/50 のみ採用。
  //
  // 各 candidate から得た 1 色を bgRgbas に積み、外→内の順に compositeOver する
  // (DOM 親子ネスト由来の合成は引き続き維持)。
  //
  // 適用クラスが resolve できない場合は unknown 昇格のため null を返す。
  const bgRgbas: Rgba[] = [];
  for (const candidate of bgCandidates) {
    // fg と同じパターン: 全クラスを走査し、最後に出現した適用可能クラスを採用する
    let candidateRgba: Rgba | null = null;
    let hasApplicable = false;
    for (const cls of candidate.classes) {
      if (!isApplicableForTheme(cls, theme)) {
        // 非適用バリアント (例: light モードの dark:bg-*) → スキップ
        continue;
      }
      const rgba = resolveClass(cls, theme, cssVars);
      if (rgba === null) {
        // 適用クラスの resolve 失敗 → unknown 昇格
        return null;
      }
      // break せず全体を走査し、最後に出現した適用可能クラスを採用する
      candidateRgba = rgba;
      hasApplicable = true;
    }
    if (hasApplicable && candidateRgba !== null) {
      bgRgbas.push(candidateRgba);
    }
  }

  // Resolve fg: Tailwind の CSS cascade ルールに従い、最後に出現した適用可能なクラスを採用する。
  // "text-gray-900 dark:text-gray-100" を dark モードで評価すると dark:text-gray-100 が後勝ち。
  // 先に break していた旧実装では dark: オーバーライドが無視されていた。
  //
  // 適用可能だが resolveClass が null を返すクラス (未知の色定義等) がある場合、
  // そのクラスが CSS cascade で後勝ちする可能性があるため全体を unknown 昇格させる。
  // サイレントスキップすると "text-foreground unknown-class" で text-foreground が採用されてしまい、
  // soundness を損なう (実ランタイムでは unknown-class が勝つ可能性がある)。
  let fgRgba: Rgba | null = null;
  for (const cls of textCandidate.classes) {
    if (!isApplicableForTheme(cls, theme)) {
      // 非適用バリアント → スキップ
      continue;
    }
    const resolved = resolveClass(cls, theme, cssVars);
    if (resolved === null) {
      // 適用クラスの resolve 失敗 → unknown 昇格 (bg 側と同じポリシー)
      return null;
    }
    // break せず全体を走査し、最後に出現した適用可能クラスを採用する
    fgRgba = resolved;
  }
  if (fgRgba === null) {
    return null;
  }

  const compositedBg = compositeOver(bgRgbas, base);
  const compositedFg = compositeOver([fgRgba], compositedBg);
  const ratio = wcagContrastRatio(compositedFg, compositedBg);

  return { bg: compositedBg, fg: compositedFg, ratio };
}

/**
 * JsxStack を Strategy B 契約に従って分類する。
 *
 * ルール適用順序 (1→7):
 * 1. bgStack 空 かつ textCandidates 空 → skip('no-color-classes')
 * 2. textCandidates 空 → skip('no-text')
 * 3. 全候補が classes: [] (完全動的) → unknown('dynamic-classname')
 * 4. bgStack に dynamic branchLabel → unknown('dynamic-bg-branch')
 * 5. textCandidates に dynamic branchLabel → unknown('dynamic-text-branch')
 * 6. 全候補静的 かつ 組合せ ≤ 32 → resolvable (worst-case ペア)
 * 7. 組合せ > 32 → unknown('combinatorial-explosion')
 *
 * @param stack - collectJsxStacks が生成した JsxStack
 * @param cssVars - parseCssVars が返した CSS 変数マップ (light/dark)
 * @param combinationLimit - 組合せ爆発の上限 (default: DEFAULT_COMBINATION_LIMIT)
 * @returns Resolution
 */
export function classifyStack(
  stack: JsxStack,
  cssVars: Record<Theme, Record<string, Rgba>>,
  combinationLimit: number = DEFAULT_COMBINATION_LIMIT,
): Resolution {
  const { bgStack, textCandidates } = stack;

  return (
    match({ bgStack, textCandidates })
      // Rule 1: bgStack 空 かつ textCandidates 空 → skip
      .with(
        {
          bgStack: P.when((b) => b.length === 0),
          textCandidates: P.when((t) => t.length === 0),
        },
        () => ({ kind: 'skip' as const, reason: 'no-color-classes' }),
      )
      // Rule 2: textCandidates 空 → skip
      .with({ textCandidates: P.when((t) => t.length === 0) }, () => ({
        kind: 'skip' as const,
        reason: 'no-text',
      }))
      // Rule 3: 全候補 classes が空配列 (完全動的)
      .with(
        P.when(({ bgStack: b, textCandidates: t }) =>
          [...b, ...t].every((c) => c.classes.length === 0),
        ),
        () => ({ kind: 'unknown' as const, reason: 'dynamic-classname' }),
      )
      // Rule 4: bgStack に dynamic または variant-pseudo branchLabel
      // variant-pseudo: sm:, hover: 等のバリアント付きクラスはランタイム依存で静的解析不能
      .with(
        P.when(({ bgStack: b }) =>
          b.some(
            (c) =>
              c.branchLabel === 'dynamic' || c.branchLabel === 'variant-pseudo',
          ),
        ),
        () => ({ kind: 'unknown' as const, reason: 'dynamic-bg-branch' }),
      )
      // Rule 5: textCandidates に dynamic または variant-pseudo branchLabel
      .with(
        P.when(({ textCandidates: t }) =>
          t.some(
            (c) =>
              c.branchLabel === 'dynamic' || c.branchLabel === 'variant-pseudo',
          ),
        ),
        () => ({ kind: 'unknown' as const, reason: 'dynamic-text-branch' }),
      )
      // Rules 6 & 7: 静的候補 → 組合せ数チェック → resolvable or explosion
      // `.otherwise()` を使用する理由: Rule 6/7 の分岐は `P.when()` 述語で実装されており、
      // ts-pattern は述語ベースのパターンに対して exhaustive 証明ができない。
      // そのため `.exhaustive()` ではなく `.otherwise()` でデフォルト分岐を処理する。
      .otherwise(() => {
        const count = countCombinations(bgStack, textCandidates);

        // Rule 7: 組合せ数爆発
        if (count > combinationLimit) {
          return {
            kind: 'unknown' as const,
            reason: 'combinatorial-explosion',
          };
        }

        // Rule 6: 全候補静的 → worst-case コントラストを計算
        // light / dark それぞれで最低コントラスト比のペアを選ぶ
        const themes: Theme[] = ['light', 'dark'];
        const worstByTheme: Partial<Record<Theme, { bg: Rgba; fg: Rgba }>> = {};

        for (const theme of themes) {
          // --background をベースとして使用 (alpha < 1 の場合は実効色に変換済み)
          const base: Rgba = getBaseBackground(cssVars, theme);

          const combinations = enumerateCombinations(bgStack, textCandidates);
          let worstRatio: number | null = null;
          let worstPair: { bg: Rgba; fg: Rgba } | null = null;

          for (const { bgCandidates, textCandidate } of combinations) {
            const resolved = resolveForTheme(
              bgCandidates,
              textCandidate,
              theme,
              cssVars,
              base,
            );
            if (resolved === null) {
              // Any unresolvable combination → unknown
              return { kind: 'unknown' as const, reason: 'dynamic-classname' };
            }
            if (worstRatio === null || resolved.ratio < worstRatio) {
              worstRatio = resolved.ratio;
              worstPair = { bg: resolved.bg, fg: resolved.fg };
            }
          }

          if (worstPair !== null) {
            worstByTheme[theme] = worstPair;
          }
        }

        // Ensure both themes resolved (if not, return unknown)
        if (!worstByTheme.light || !worstByTheme.dark) {
          return { kind: 'unknown' as const, reason: 'dynamic-classname' };
        }

        return {
          kind: 'resolvable' as const,
          themes: {
            light: worstByTheme.light,
            dark: worstByTheme.dark,
          },
        };
      })
  );
}
