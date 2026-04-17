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
  // Phase 1: bgStack は候補の配列 (各要素 = 1候補)
  // 組合せ数 = textCandidates の長さ (bgStack の直積は 1^n = 1)
  // ただし bgStack が長くなると将来的に積が増える可能性があるため
  // 安全のため bgStack.length も因子に含める
  if (bgStack.length === 0) {
    return 0;
  }
  return Math.max(bgStack.length, 1) * textCandidates.length;
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
  // Resolve each bg class in sequence (Porter-Duff over)
  const bgRgbas: Rgba[] = [];
  for (const candidate of bgCandidates) {
    for (const cls of candidate.classes) {
      const rgba = resolveClass(cls, theme, cssVars);
      if (rgba === null) {
        return null;
      }
      bgRgbas.push(rgba);
    }
  }

  // Resolve fg (first resolvable class wins)
  let fgRgba: Rgba | null = null;
  for (const cls of textCandidate.classes) {
    const resolved = resolveClass(cls, theme, cssVars);
    if (resolved !== null) {
      fgRgba = resolved;
      break;
    }
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
      // Rule 4: bgStack に dynamic branchLabel
      .with(
        P.when(({ bgStack: b }) => b.some((c) => c.branchLabel === 'dynamic')),
        () => ({ kind: 'unknown' as const, reason: 'dynamic-bg-branch' }),
      )
      // Rule 5: textCandidates に dynamic branchLabel
      .with(
        P.when(({ textCandidates: t }) =>
          t.some((c) => c.branchLabel === 'dynamic'),
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
