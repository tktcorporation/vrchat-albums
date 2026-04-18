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
 * 2 つの branchId が「排他」(mutually exclusive) かどうかを判定する。
 *
 * branchId のフォーマット: `cn@<offset>:<argIndex>:<suffix>`
 * 例: "cn@100:0:c" (consequent), "cn@100:0:a" (alternate), "cn@100:0:rhs" (||右辺)
 *
 * 同じ cn() 呼び出し (= 同じ `cn@<offset>:<argIndex>` prefix) から来た候補は
 * **排他** — ランタイムで同時に選ばれることがない。
 * 異なる cn() 呼び出しの候補は**独立** — 同時に選ばれてよい。
 *
 * 旧実装の equality チェック (`a === b`) は、異なる cn() 呼び出しの分岐を
 * 「非互換」と誤判定し、独立条件のネストで全組合せが除外されていた (G2 バグ)。
 *
 * @param a - 一方の branchId (undefined = 無条件)
 * @param b - 他方の branchId (undefined = 無条件)
 * @returns true なら「同じ cn() の別分岐 = 排他」→ 組合せ不可
 */
function areMutuallyExclusive(
  a: string | undefined,
  b: string | undefined,
): boolean {
  // 片方でも undefined (無条件) なら排他でない
  if (a === undefined || b === undefined) {
    return false;
  }
  // 完全一致 (同じ分岐の同じ側) → 排他でない (同一分岐は組合せ可能)
  if (a === b) {
    return false;
  }
  // cn@<offset>:<argIndex>:<suffix> の suffix を除く prefix 部分が同じなら
  // 同一 cn() 呼び出しの別分岐 = 排他
  const aPrefix = a.split(':').slice(0, -1).join(':');
  const bPrefix = b.split(':').slice(0, -1).join(':');
  return aPrefix === bPrefix && aPrefix.length > 0;
}

/**
 * 選択された bg 候補リスト全体と text 候補の branchId が全て互換かどうかを判定する。
 *
 * 各層から選んだ bg 候補の branchId と text の branchId の組合せで、
 * 「同じ cn() の排他的な別分岐」が混在する場合は非互換と判定する。
 * 異なる cn() 呼び出し由来の branchId は独立なので互換と見なす。
 *
 * 旧実装の問題 (G2):
 * 異なる cn() 呼び出し ("cn@100:0:c" と "cn@200:0:c") を非互換と誤判定し、
 * 独立条件のネストで全組合せが除外されていた。
 *
 * 修正後:
 * 排他判定は「同じ cn@<offset>:<argIndex> prefix を持ち suffix だけ異なる」場合のみ。
 *
 * @param selectedBgs - 各層から選んだ bg 候補のリスト
 * @param textCandidate - text 候補
 */
function isCombinationCompatible(
  selectedBgs: ClassCandidate[],
  textCandidate: ClassCandidate,
): boolean {
  // 全ての bg branchId と text branchId の間で排他チェック。
  // areMutuallyExclusive が true = 同一 cn() の別分岐が混在 → 非互換 (到達不能な組合せ)。
  const textId = textCandidate.branchId;
  for (const bg of selectedBgs) {
    if (areMutuallyExclusive(bg.branchId, textId)) {
      return false;
    }
  }
  // 選択された bg 候補同士の排他チェック。
  // 異なる cn() 由来 (例: 親 cn と子 cn) は独立なので排他でない。
  // 同一 cn() の consequent + alternate が混在する場合のみ非互換。
  for (let i = 0; i < selectedBgs.length; i++) {
    for (let j = i + 1; j < selectedBgs.length; j++) {
      if (
        areMutuallyExclusive(selectedBgs[i].branchId, selectedBgs[j].branchId)
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * bgStack の各層から 1 つずつ alternative を選ぶ直積 × textCandidates を列挙する。
 *
 * bgStack は階層配列 (ClassCandidate[][]):
 * - 外層: DOM 階層 (祖先→自身の順)
 * - 内層: その層での alternative 候補群 (排他的選択肢)
 *
 * 各層から 1 つ alternative を選ぶ直積で「具体的な合成スタック」を生成し、
 * さらに textCandidates の各候補と組み合わせる。
 *
 * branchId 互換チェック: 選んだ全 bg 候補と text 候補の branchId が互換な組合せのみ返す。
 * これにより cn(cond ? 'bg-black' : 'bg-white') の親 + text-black の子で
 * 「bg-black + text-black」と「bg-white + text-black」が独立の組合せとして評価される。
 *
 * @param bgStack - 背景候補の階層配列 (外→内の順)
 * @param textCandidates - テキスト候補の配列
 * @returns 有効な組合せの配列。各要素は { bgCandidates, textCandidate }
 */
function enumerateCombinations(
  bgStack: ClassCandidate[][],
  textCandidates: ClassCandidate[],
): { bgCandidates: ClassCandidate[]; textCandidate: ClassCandidate }[] {
  // bgStack の各層から 1 つずつ alternative を選ぶ直積を生成する。
  // 初期状態: 1 つの空パス [[]]
  // 各層を順に処理し、その層の各 alternative を現在のパスに追加して展開する。
  let bgPaths: ClassCandidate[][] = [[]];

  for (const layer of bgStack) {
    const nextPaths: ClassCandidate[][] = [];
    for (const currentPath of bgPaths) {
      for (const alt of layer) {
        nextPaths.push([...currentPath, alt]);
      }
    }
    bgPaths = nextPaths;
  }

  // bgStack が空 (祖先に bg 指定なし) の場合: bgPaths = [[]] (空パスが 1 つ)
  // resolveForTheme が bgRgbas = [] → compositeOver([]) = base で処理する。
  // (bgStack 空 = ページ背景という設計と一致する)

  const results: {
    bgCandidates: ClassCandidate[];
    textCandidate: ClassCandidate;
  }[] = [];

  for (const textCandidate of textCandidates) {
    for (const selectedBgs of bgPaths) {
      // branchId 互換チェック: 選んだ bg 候補群と text 候補が全て互換か確認する。
      // 非互換な組合せ (到達不能な分岐) は除外して偽陽性/偽陰性を防ぐ。
      if (!isCombinationCompatible(selectedBgs, textCandidate)) {
        continue;
      }
      results.push({ bgCandidates: selectedBgs, textCandidate });
    }
  }

  return results;
}

/**
 * 組合せ数を計算する。
 *
 * bgStack の各層のサイズの直積 × textCandidates の数が組合せ数。
 * 各層から 1 つずつ alternative を選び、全層の選択の直積が bg パス数となる。
 *
 * bgStack が空の場合 (親 bg 指定なし) でも textCandidates は全て評価対象になるため
 * textCandidates.length を返す (0 を返すと combinatorial-explosion guard が bypass される)。
 */
function countCombinations(
  bgStack: ClassCandidate[][],
  textCandidates: ClassCandidate[],
): number {
  // 各層のサイズの積 = bg パスの総数
  const bgPathCount = bgStack.reduce((acc, layer) => acc * layer.length, 1);
  // bg パス数 × text 候補数 = 全組合せ数
  return bgPathCount * textCandidates.length;
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
 * 6. 全候補静的 かつ 組合せ ≤ 32 → resolvable (worst-case ペア)、色解決失敗なら unknown('unresolved-class')
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

  // bgStack (ClassCandidate[][]) を flat にして rules 3/4 の判定で使用する。
  // flat は「全層の全 alternative 候補」を一覧にするためのもの。
  const allBgCandidates = bgStack.flat();

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
      // bgStack の全層の全 alternative + textCandidates が全て classes:[] のとき
      .with(
        P.when(({ textCandidates: t }) =>
          [...allBgCandidates, ...t].every((c) => c.classes.length === 0),
        ),
        () => ({ kind: 'unknown' as const, reason: 'dynamic-classname' }),
      )
      // Rule 4: bgStack に dynamic または variant-pseudo branchLabel
      // variant-pseudo: sm:, hover: 等のバリアント付きクラスはランタイム依存で静的解析不能
      // bgStack の全層の全 alternative を走査して判定する
      .with(
        P.when(() =>
          allBgCandidates.some(
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
              // 'unresolved-class' を使用して Rule 3 の 'dynamic-classname' と区別する。
              // Rule 3: 全候補が classes:[] (完全動的) / ここ: 静的クラスだが色解決に失敗した
              return { kind: 'unknown' as const, reason: 'unresolved-class' };
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
          return { kind: 'unknown' as const, reason: 'unresolved-class' };
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
