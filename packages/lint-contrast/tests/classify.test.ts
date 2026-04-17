/**
 * classify.ts の単体テスト。
 *
 * Strategy B 分類ルール 1〜7 を全て検証する。
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyStack } from '../src/classify.js';
import { parseCssVars } from '../src/parseCssVars.js';
import type { ClassCandidate, JsxStack } from '../src/types.js';

const MOCK_CSS = path.resolve(
  import.meta.dirname,
  '../test-fixtures/mock-index.css',
);

const cssVars = parseCssVars(MOCK_CSS);

// ---------------------------------------------------------------------------
// テスト用ヘルパー: JsxStack を簡潔に構築する
// ---------------------------------------------------------------------------

/**
 * bgStack は ClassCandidate[][] (階層配列)。
 * 各要素が 1 つの DOM 層を表し、その層の alternative 候補群を含む。
 * - 1 つの bg 候補しかない場合: [[staticBg('bg-card')]] (1層1候補)
 * - 複数層: [[staticBg('bg-background')], [staticBg('bg-card')]] (2層各1候補)
 * - 分岐層: [[{bg-black, cn:0:c}, {bg-white, cn:0:a}]] (1層2候補)
 */
function makeStack(
  bgStack: ClassCandidate[][],
  textCandidates: ClassCandidate[],
): JsxStack {
  return {
    file: 'test.tsx',
    line: 1,
    column: 1,
    elementName: 'p',
    bgStack,
    textCandidates,
  };
}

function staticBg(...classes: string[]): ClassCandidate {
  return { classes };
}

function staticText(...classes: string[]): ClassCandidate {
  return { classes };
}

function dynamicCandidate(): ClassCandidate {
  return { classes: [], branchLabel: 'dynamic' };
}

// ---------------------------------------------------------------------------
// Rule 1: bgStack 空 かつ textCandidates 空 → skip('no-color-classes')
// ---------------------------------------------------------------------------

describe('Rule 1: both empty → skip(no-color-classes)', () => {
  it('returns skip when both bgStack and textCandidates are empty', () => {
    const stack = makeStack([], []);
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('skip');
    if (result.kind === 'skip') {
      expect(result.reason).toBe('no-color-classes');
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 2: textCandidates 空 → skip('no-text')
// ---------------------------------------------------------------------------

describe('Rule 2: textCandidates empty → skip(no-text)', () => {
  it('returns skip when bgStack has items but textCandidates is empty', () => {
    const stack = makeStack([[staticBg('bg-background')]], []);
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('skip');
    if (result.kind === 'skip') {
      expect(result.reason).toBe('no-text');
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 3: 全候補 classes が空配列 → unknown('dynamic-classname')
// ---------------------------------------------------------------------------

describe('Rule 3: all classes empty → unknown(dynamic-classname)', () => {
  it('returns unknown when all candidates have empty classes arrays', () => {
    const stack = makeStack([[{ classes: [] }]], [{ classes: [] }]);
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('dynamic-classname');
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 4: bgStack に dynamic branchLabel → unknown('dynamic-bg-branch')
// ---------------------------------------------------------------------------

describe('Rule 4: dynamic branchLabel in bgStack → unknown(dynamic-bg-branch)', () => {
  it('returns unknown when bgStack contains a dynamic candidate', () => {
    const stack = makeStack(
      [[dynamicCandidate()]],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('dynamic-bg-branch');
    }
  });

  it('returns unknown when bgStack has mixed static and dynamic candidates (same layer)', () => {
    // 同一層に static と dynamic が混在 → dynamic-bg-branch
    const stack = makeStack(
      [[staticBg('bg-background'), dynamicCandidate()]],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('dynamic-bg-branch');
    }
  });

  it('returns unknown when bgStack has dynamic candidate in a different layer', () => {
    // 異なる層に dynamic → dynamic-bg-branch
    const stack = makeStack(
      [[staticBg('bg-background')], [dynamicCandidate()]],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('dynamic-bg-branch');
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 5: textCandidates に dynamic branchLabel → unknown('dynamic-text-branch')
// ---------------------------------------------------------------------------

describe('Rule 5: dynamic branchLabel in textCandidates → unknown(dynamic-text-branch)', () => {
  it('returns unknown when textCandidates contains a dynamic candidate', () => {
    const stack = makeStack(
      [[staticBg('bg-background')]],
      [dynamicCandidate()],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('dynamic-text-branch');
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 6: 全候補静的 + 組合せ ≤ 32 → resolvable (worst-case pair)
// ---------------------------------------------------------------------------

describe('Rule 6: all static, combinations ≤ 32 → resolvable', () => {
  it('resolves bg-background + text-foreground (passes AA in both modes)', () => {
    const stack = makeStack(
      [[staticBg('bg-background')]],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('resolvable');
    if (result.kind === 'resolvable') {
      // Both themes must have bg and fg
      expect(result.themes.light.bg).toBeDefined();
      expect(result.themes.light.fg).toBeDefined();
      expect(result.themes.dark.bg).toBeDefined();
      expect(result.themes.dark.fg).toBeDefined();
    }
  });

  it('resolvable worst-case: lowest contrast ratio pair is selected per theme', () => {
    // bg-background + text-foreground in light mode is high contrast (~17)
    // in dark mode is also high contrast (~12)
    const stack = makeStack(
      [[staticBg('bg-background')]],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    if (result.kind === 'resolvable') {
      // Light: white bg, near-black fg → high contrast
      const lightBg = result.themes.light.bg;
      const lightFg = result.themes.light.fg;
      expect(lightBg.r).toBeCloseTo(1, 1); // near white
      expect(lightFg.r).toBeLessThan(0.3); // near black
    }
  });

  it('resolves bg-card + text-card-foreground correctly', () => {
    const stack = makeStack(
      [[staticBg('bg-card')]],
      [staticText('text-card-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    // card-foreground is the same as foreground in mock CSS
    expect(result.kind).toBe('resolvable');
  });

  it('resolves alpha composite: bg-background + bg-white/30 + text-muted-foreground (2 layers)', () => {
    // 2 つの別層 (親 bg-background, 子 bg-white/30) が compositeOver される
    const stack = makeStack(
      [[staticBg('bg-background')], [staticBg('bg-white/30')]],
      [staticText('text-muted-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    // Should be resolvable since all classes are static
    // bg-white/30 has alpha, which will be composited
    expect(result.kind).toBe('resolvable');
  });
});

// ---------------------------------------------------------------------------
// Rule 7: 組合せ数 > 32 → unknown('combinatorial-explosion')
// ---------------------------------------------------------------------------

describe('Rule 7: combinations > 32 → unknown(combinatorial-explosion)', () => {
  it('returns unknown when combinations exceed 32 (1 bg layer × 33 text)', () => {
    // Create 33+ text candidates (bgStack = [[bg-background]], textCandidates = 33 → 33 combinations)
    const textCandidates: ClassCandidate[] = [];
    for (let i = 0; i < 33; i++) {
      textCandidates.push(staticText('text-foreground'));
    }
    const stack = makeStack([[staticBg('bg-background')]], textCandidates);
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('combinatorial-explosion');
    }
  });

  // C3 修正 (PR #806 CodeRabbit): bgStack 空 + textCandidates 33 件でも
  // combinatorial-explosion が発火すること。
  // 修正前: countCombinations が bgStack.length === 0 のとき 0 を返していたため guard が bypass された。
  // 修正後: bgStack 空でも textCandidates.length を返すため正しく explosion 検知できる。
  it('C3: bgStack empty + 33 textCandidates → unknown(combinatorial-explosion)', () => {
    const textCandidates: ClassCandidate[] = [];
    for (let i = 0; i < 33; i++) {
      textCandidates.push(staticText('text-foreground'));
    }
    // bgStack = [] (空), textCandidates = 33 → 33 組合せ > 32 → explosion
    const stack = makeStack([], textCandidates);
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('combinatorial-explosion');
    }
  });

  it('C3: bgStack empty + 32 textCandidates → NOT explosion (exactly at limit)', () => {
    const textCandidates: ClassCandidate[] = [];
    for (let i = 0; i < 32; i++) {
      textCandidates.push(staticText('text-foreground'));
    }
    const stack = makeStack([], textCandidates);
    const result = classifyStack(stack, cssVars);
    // 32 は combinationLimit (default: 32) 以下なので explosion ではない → resolvable
    expect(result.kind).toBe('resolvable');
  });

  it('hierarchical bgStack: 2 layers × 2 alternatives × 1 text = 4 combinations (does not overflow limit)', () => {
    // bgStack: [[alt1, alt2], [alt3, alt4]] → 2×2 = 4 bg paths × 1 text = 4 combinations
    const stack = makeStack(
      [
        [staticBg('bg-background'), staticBg('bg-card')],
        [staticBg('bg-muted'), staticBg('bg-white')],
      ],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    // 4 < 32 → resolvable
    expect(result.kind).toBe('resolvable');
  });

  it('hierarchical bgStack: 1 layer × 33 alternatives × 1 text = 33 combinations → explosion', () => {
    // bgStack: [[alt1, ..., alt33]] → 33 bg paths × 1 text = 33 > 32 → explosion
    const alts: ClassCandidate[] = [];
    for (let i = 0; i < 33; i++) {
      alts.push(staticBg('bg-background'));
    }
    const stack = makeStack([alts], [staticText('text-foreground')]);
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('combinatorial-explosion');
    }
  });
});

// ---------------------------------------------------------------------------
// end-to-end スモークテスト (フィクスチャ経由)
// ---------------------------------------------------------------------------

describe('Smoke tests via fixtures', () => {
  it('skip-no-colors: no bg/text → stack is empty so classifyStack not called', () => {
    // skip-no-colors has no bg/text classes, so collectJsxStacks returns []
    // We simulate the edge case of an empty-class stack
    const stack = makeStack([], []);
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('skip');
  });

  it('warn-dynamic-class: dynamic template literal → unknown(dynamic-text-branch)', () => {
    // Template literal with expression → dynamic branchLabel
    const stack = makeStack(
      [[staticBg('bg-background')]],
      [dynamicCandidate()],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(['dynamic-text-branch', 'dynamic-classname']).toContain(
        result.reason,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// dark: バリアントの正しい処理 (指摘 1 / 指摘 2 の修正検証)
// ---------------------------------------------------------------------------

describe('dark: variant handling', () => {
  // 指摘 1: light モードで dark:bg-* はスキップされ、bg-white が採用される
  it('dark:bg-* in bgStack is skipped in light mode (not treated as null → unknown)', () => {
    // bg-white → white in light, dark:bg-gray-900 → skipped in light
    // bgStack に dark: バリアントを含んでも light モードで resolvable になること
    const stack = makeStack(
      [[staticBg('bg-white', 'dark:bg-background')]],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    // dark:bg-background は light モードでスキップされ、bg-white のみで解決できる
    expect(result.kind).toBe('resolvable');
  });

  // 指摘 1: dark モードでは dark:bg-* が採用される
  it('dark:bg-* in bgStack is applied in dark mode', () => {
    const stack = makeStack(
      [[staticBg('bg-white', 'dark:bg-background')]],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('resolvable');
    if (result.kind === 'resolvable') {
      // dark モードの bg は --background (dark) になるので白ではない
      const darkBg = result.themes.dark.bg;
      // mock CSS の dark --background: 220 27% 8% → 暗い色なので r,g,b が 0.15 未満
      expect(darkBg.r).toBeLessThan(0.15);
      expect(darkBg.g).toBeLessThan(0.15);
      expect(darkBg.b).toBeLessThan(0.25);
    }
  });

  // 指摘 2: text に dark: オーバーライドがある場合、dark モードでは後勝ちクラスが採用される
  it('dark:text-* overrides base text class in dark mode (last applicable class wins)', () => {
    // text-foreground は light モードの暗い色, dark:text-foreground は dark モードの明るい色
    // light: text-foreground が採用 (dark:text-foreground はスキップ)
    // dark:  dark:text-foreground が後勝ち (CSS cascade に準拠)
    const stack = makeStack(
      [[staticBg('bg-background')]],
      [staticText('text-foreground', 'dark:text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('resolvable');
    if (result.kind === 'resolvable') {
      // dark モードの fg は dark --foreground (明るい色: 220 15% 85%)
      const darkFg = result.themes.dark.fg;
      // dark foreground は明るい色なので r,g,b が 0.7 以上
      expect(darkFg.r).toBeGreaterThan(0.7);
    }
  });

  // bg-white + dark:bg-gray-900 の両モード独立計算 (指摘 1 の統合テスト)
  it('bg-white dark:bg-background resolves independently per theme', () => {
    const stack = makeStack(
      [[staticBg('bg-white', 'dark:bg-background')]],
      [staticText('text-foreground', 'dark:text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('resolvable');
    if (result.kind === 'resolvable') {
      // light: bg=white (r≈1), dark: bg=dark-background (r<0.15)
      expect(result.themes.light.bg.r).toBeGreaterThan(0.9);
      expect(result.themes.dark.bg.r).toBeLessThan(0.15);
    }
  });
});

// ---------------------------------------------------------------------------
// 指摘 1 修正検証 (PR #806): bg CSS cascade — 同一 candidate 内で最後勝ち
// ---------------------------------------------------------------------------

describe('bg CSS cascade: last applicable class within each candidate wins', () => {
  // "bg-white dark:bg-background" を dark モードで評価
  // → dark:bg-background のみ採用 (bg-white は常に適用可能だが後続の dark:bg-background が後勝ち)
  it('dark:bg-* overrides preceding bg-* in dark mode (last applicable class wins)', () => {
    // bg-white は常に適用、dark:bg-background は dark でのみ適用
    // dark モードでは bg-white → dark:bg-background の順で後勝ち → dark:bg-background (濃紺)
    // light モードでは bg-white のみ適用 (dark:bg-background はスキップ) → 白
    const stack = makeStack(
      [[staticBg('bg-white', 'dark:bg-background')]],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('resolvable');
    if (result.kind === 'resolvable') {
      // dark モード: dark:bg-background が後勝ち → mock CSS: 220 27% 8% (濃紺, r < 0.15)
      expect(result.themes.dark.bg.r).toBeLessThan(0.15);
      // light モード: bg-white のみ適用 → 白 (r ≈ 1)
      expect(result.themes.light.bg.r).toBeGreaterThan(0.9);
    }
  });

  it('bg-white bg-black (both light-applicable) → bg-black wins (last class), not blended', () => {
    // 同一 candidate 内に複数の bg クラス (両方 light で適用可能)
    // CSS cascade: 最後の background-color 宣言が有効 → bg-black が後勝ち
    // 旧実装: 両方を compositeOver して不正な中間色になっていた
    // 修正後: bg-black のみ採用 → 黒 (r ≈ 0)
    const stack = makeStack(
      [[staticBg('bg-white', 'bg-black')]],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('resolvable');
    if (result.kind === 'resolvable') {
      // bg-black が後勝ち → 黒 (r ≈ 0, g ≈ 0, b ≈ 0)
      expect(result.themes.light.bg.r).toBeLessThan(0.1);
      expect(result.themes.light.bg.g).toBeLessThan(0.1);
      expect(result.themes.light.bg.b).toBeLessThan(0.1);
      // dark モードも同様に bg-black が後勝ち
      expect(result.themes.dark.bg.r).toBeLessThan(0.1);
    }
  });

  it('same-element bg-background bg-card (both resolvable) → resolvable (last bg-card color used)', () => {
    // mock CSS: light では --background = white (100%L), --card = white (100%L) — 同値
    // 両方 resolveClass で解決できる → resolvable になる
    const stack = makeStack(
      [[staticBg('bg-background', 'bg-card')]],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    // 両方ライト適用可能かつ同一候補内 → 最後のクラス (bg-card) が採用
    // どちらも白なので両テーマで resolvable になるはず
    expect(result.kind).toBe('resolvable');
  });
});

// ---------------------------------------------------------------------------
// 指摘 1 修正検証: text-only stack (bgStack 空) が --background ベースで解決可能
// ---------------------------------------------------------------------------

describe('text-only stack (bgStack empty) resolves against implicit --background', () => {
  // bgStack が空の場合、classify は暗黙の --background をベースとして使用する。
  // collectJsxStacks の修正により、祖先に bg 指定のない要素も JsxStack に記録されるため、
  // ページデフォルト背景に描画される一般テキストのコントラスト検証が可能になる。

  it('text-only stack with text-foreground is resolvable (uses --background as base)', () => {
    // bgStack 空 → Rule 6 の otherwise ブランチが実行される。
    // countCombinations([], [...]) === 1 (bgPathCount=1, textCount=1) ≤ 32 なので resolvable へ進む。
    // resolveForTheme は bgRgbas = [] で compositeOver([], base) = base を使用する。
    const stack = makeStack([], [staticText('text-foreground')]);
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('resolvable');
    if (result.kind === 'resolvable') {
      // bg は --background そのもの (合成なし)
      expect(result.themes.light.bg).toBeDefined();
      expect(result.themes.dark.bg).toBeDefined();
      expect(result.themes.light.fg).toBeDefined();
      expect(result.themes.dark.fg).toBeDefined();
    }
  });

  it('text-only stack with dynamic textCandidates → unknown(dynamic-text-branch)', () => {
    // bgStack 空 + dynamic text → Rule 5 が発火して unknown になる
    const stack = makeStack([], [dynamicCandidate()]);
    const result = classifyStack(stack, cssVars);
    // Rule 3 or Rule 5 のどちらかで unknown になる
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      // dynamic 候補は dynamic-text-branch または dynamic-classname のいずれかで unknown
      expect(['dynamic-text-branch', 'dynamic-classname']).toContain(
        result.reason,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 指摘 2 結合確認 (PR #806): 要素内 bg cascade vs 親子 compositeOver
// ---------------------------------------------------------------------------

describe('element-vs-ancestor bg cascade (Issue 2 validation)', () => {
  // 親子ネスト: 親 bg-background + 子 bg-black/50 → compositeOver が適用される
  // <div className="bg-background"><span className="text-white bg-black/50">
  //   → 子の bgStack = [[{ classes: ['bg-background'] }], [{ classes: ['bg-black/50'] }]]
  //   → compositeOver([white, black/50], base) = 中間のグレー
  it('parent-child nesting: ancestor bg + alpha child bg are composited (separate bgStack layers)', () => {
    // bgStack に 2 層 (親と子それぞれ独立した層) → compositeOver される
    // light モード: bg-background = white (r=1,g=1,b=1), bg-black/50 = black at 0.5
    // compositeOver([white, black/50], white_base) = 0.5*0 + (1-0.5)*1 = 0.5 (グレー)
    const stack = makeStack(
      [
        [staticBg('bg-background')], // 層1: 親要素 (ancestor)
        [staticBg('bg-black/50')], // 層2: 子要素 (element itself, with alpha)
      ],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('resolvable');
    if (result.kind === 'resolvable') {
      // compositeOver した結果: 白 (bg-background) の上に黒/50 → グレー (r ≈ 0.5)
      // 純白 (r=1) でも純黒 (r=0) でもなく中間値
      expect(result.themes.light.bg.r).toBeGreaterThan(0.3);
      expect(result.themes.light.bg.r).toBeLessThan(0.7); // ≈ 0.5 (合成で中間色)
    }
  });

  // 同一要素内: cn('bg-black/50', 'bg-white/50') → 最後勝ちで bg-white/50 のみ採用
  // (compositeOver しない。CSS cascade: 後のクラスが background-color を上書き)
  it('same-element cn(bg-black/50, bg-white/50) uses last-wins bg-white/50 only (no compositeOver)', () => {
    // bgStack に 1 層 1 候補 { classes: ['bg-black/50', 'bg-white/50'] }
    // → resolveForTheme 内で最後の適用可能クラス bg-white/50 のみ採用 (bg-black/50 は上書き)
    // → compositeOver([white/50], base) = 白系の薄い色
    // ≠ compositeOver([black/50, white/50], base) = 黒+白の合成 (誤った旧動作)
    const stack = makeStack(
      [[staticBg('bg-black/50', 'bg-white/50')]], // 単一層・単一候補に両クラス
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('resolvable');
    if (result.kind === 'resolvable') {
      // bg-white/50 のみ compositeOver(base) → 白寄りの色
      // base = bg-background (light: white → r=1, g=1, b=1)
      // compositeOver([{r:1,g:1,b:1,a:0.5}], {r:1,g:1,b:1,a:1}) = {r:1,g:1,b:1,a:1} (純白)
      // bg-black/50 との compositeOver は起きないことを確認
      // (bg-black/50 だけなら bg.r ≈ 0.5 になるが、bg-white/50 後勝ちなので bg.r ≈ 1)
      expect(result.themes.light.bg.r).toBeGreaterThan(0.9);
      expect(result.themes.light.bg.g).toBeGreaterThan(0.9);
      expect(result.themes.light.bg.b).toBeGreaterThan(0.9);
    }
  });
});

// ---------------------------------------------------------------------------
// 指摘 1 修正 (PR #806 Codex): variant-pseudo textCandidates → unknown
// ---------------------------------------------------------------------------

describe('variant-pseudo branchLabel → unknown (Rule 5)', () => {
  it('variant-pseudo in textCandidates falls through to unknown(dynamic-text-branch)', () => {
    // sm:text-foreground のみ持つ textCandidates は variant-pseudo → Rule 5 で unknown
    // classify 側は branchLabel === 'variant-pseudo' を dynamic と同等に扱う
    const stack = makeStack(
      [[staticBg('bg-background')]],
      [{ classes: [], branchLabel: 'variant-pseudo' }],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('dynamic-text-branch');
    }
  });

  it('variant-pseudo in bgStack falls through to unknown(dynamic-bg-branch)', () => {
    // hover:bg-card → variant-pseudo bgStack → Rule 4 で unknown
    const stack = makeStack(
      [[{ classes: [], branchLabel: 'variant-pseudo' }]],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('dynamic-bg-branch');
    }
  });
});

// ---------------------------------------------------------------------------
// 指摘 2 修正 (PR #806 Codex): dynamicVar || 'literal' → unknown
// ---------------------------------------------------------------------------

describe('LogicalExpression dynamic left-side → unknown (Rule 5)', () => {
  it('cn(dynamicVar || "text-foreground") → unknown(dynamic-text-branch)', () => {
    // dynamicVar が truthy のとき dynamicVar 自身が使われる可能性がある
    // → dynamic 候補が textCandidates に存在 → Rule 5 で unknown
    const stack = makeStack(
      [[staticBg('bg-background')]],
      [
        { classes: ['text-foreground'], branchLabel: 'conditional(||)' },
        { classes: [], branchLabel: 'dynamic' },
      ],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('dynamic-text-branch');
    }
  });
});

// ---------------------------------------------------------------------------
// PR #806 Codex 追加指摘 1: 適用可能だが resolve 不能な fg/bg クラスは unknown 昇格
// ---------------------------------------------------------------------------

describe('unresolvable applicable class → unknown (soundness)', () => {
  // fg: 適用可能だが resolveClass が null を返すクラスがあると、
  // そのクラスが CSS cascade で後勝ちする可能性があるため全体を unknown 昇格させる。
  // 旧実装: 解決不能クラスをサイレントスキップして前の結果を維持 → soundness 違反
  // 新実装: 解決不能クラス検出時に null を返し → unknown(dynamic-classname) に落ちる

  it('fg: text-foreground followed by unresolvable class → unknown', () => {
    // "text-foreground" は解決可能, "__unknown_color__" は resolveClass が null を返す想定
    // CSS cascade 的には "__unknown_color__" が後勝ちするため結果が確定できない
    // → resolveForTheme が null → unknown(unresolved-class) [C8 修正: dynamic-classname から変更]
    const stack = makeStack(
      [[staticBg('bg-background')]],
      // __unknown_color__ は resolveClass に未登録 → null を返す
      [staticText('text-foreground', '__unknown_color__')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('unresolved-class');
    }
  });

  it('fg: unresolvable class before text-foreground → unknown (any applicable unresolvable triggers unknown)', () => {
    // "__unknown_color__" が先で "text-foreground" が後: cascade では text-foreground が後勝ちだが、
    // "__unknown_color__" は適用可能かつ resolve 不能 → 前後問わず全体を unknown 昇格させる
    // (位置に関わらず適用可能な未知クラスは結果を不確定にする)
    const stack = makeStack(
      [[staticBg('bg-background')]],
      [staticText('__unknown_color__', 'text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    // "__unknown_color__" が適用可能かつ resolve 不能 → unknown 昇格
    expect(result.kind).toBe('unknown');
  });

  it('bg: bg-card followed by unresolvable class → unknown', () => {
    // bg 側も同じポリシー: 適用可能かつ resolve 不能なクラスがあれば全体 null → unknown
    // C8 修正: reason は 'unresolved-class' (static class だが color resolve 失敗)
    const stack = makeStack(
      [[staticBg('bg-card', '__unknown_bg__')]],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('unresolved-class');
    }
  });

  it('non-applicable dark: unresolvable class does not cause unknown in light mode', () => {
    // "dark:__unknown__" は light モードでは isApplicableForTheme = false → スキップ
    // → light モードでは text-foreground のみ採用 → resolvable
    const stack = makeStack(
      [[staticBg('bg-background')]],
      [staticText('text-foreground', 'dark:__unknown__')],
    );
    const result = classifyStack(stack, cssVars);
    // dark:__unknown__ は light モードで非適用 → スキップ → text-foreground で resolvable
    // dark モードでは dark:__unknown__ が適用可能かつ resolve 不能 → unknown 昇格
    // 全体の result は両テーマを評価するため unknown になる
    expect(result.kind).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// branchId 互換性フィルタ: cn(cond ? 'bg-black text-white' : 'bg-white text-black')
// ---------------------------------------------------------------------------

describe('branchId filtering in enumerateCombinations', () => {
  // isCombinationCompatible の動作確認 (enumerateCombinations 経由で間接テスト)

  it('same branchId on bg and text → compatible → resolvable (both branches AA)', () => {
    // cn(cond ? 'bg-black text-white' : 'bg-white text-black')
    // bg の 2 候補は同一要素の cn() の分岐なので同一層の alternative として格納:
    // bgStack: [[{ classes: ['bg-black'], branchId: 'cn:0:c' }, { classes: ['bg-white'], branchId: 'cn:0:a' }]]
    // text: [{ classes: ['text-white'], branchId: 'cn:0:c' }, { classes: ['text-black'], branchId: 'cn:0:a' }]
    // 有効組合せ: (bg-black, text-white) → ratio≈21, (bg-white, text-black) → ratio≈21 → resolvable
    const stack = makeStack(
      [
        [
          { classes: ['bg-black'], branchId: 'cn:0:c' },
          { classes: ['bg-white'], branchId: 'cn:0:a' },
        ],
      ],
      [
        { classes: ['text-white'], branchId: 'cn:0:c' },
        { classes: ['text-black'], branchId: 'cn:0:a' },
      ],
    );
    const result = classifyStack(stack, cssVars);
    // 両分岐が AA クリア (black on white ≈ 21, white on black ≈ 21)
    // branchId フィルタなし (旧実装) では bg-black+text-black (ratio≈1) で error になる
    expect(result.kind).toBe('resolvable');
  });

  it('different branchId → incompatible combination excluded (4→2 combinations)', () => {
    // branchId が異なる組合せ (bg-black×text-black, bg-white×text-white) は除外される。
    // 除外されなければ ratio≈1 で low-contrast になるが、
    // 正しく除外されれば 2 通りのみ評価され resolvable (AA クリア) になる。
    const stack = makeStack(
      [
        [
          { classes: ['bg-black'], branchId: 'cn:0:c' },
          { classes: ['bg-white'], branchId: 'cn:0:a' },
        ],
      ],
      [
        { classes: ['text-white'], branchId: 'cn:0:c' },
        { classes: ['text-black'], branchId: 'cn:0:a' },
      ],
    );
    const result = classifyStack(stack, cssVars);
    // bg-black+text-black / bg-white+text-white は除外されるため、
    // worst-case は black on white (ratio≈21) → AA クリア → resolvable
    expect(result.kind).toBe('resolvable');
    if (result.kind === 'resolvable') {
      // light: bg-black + text-white or bg-white + text-black → ratio≈21
      const lightBg = result.themes.light.bg;
      const lightFg = result.themes.light.fg;
      const isBlackOrWhite = (v: number) => v < 0.1 || v > 0.9;
      expect(isBlackOrWhite(lightBg.r)).toBe(true);
      expect(isBlackOrWhite(lightFg.r)).toBe(true);
    }
  });

  it('branchId=undefined (unconditional) is compatible with all branchIds', () => {
    // 無条件の bg 候補 (branchId=undefined) は全ての text 候補と互換
    // cn('bg-background', cond ? 'text-foreground' : 'text-muted-foreground')
    // bgStack: [[{ classes: ['bg-background'], branchId: undefined }]] (1層1候補, 無条件)
    // text: [{ classes: ['text-foreground'], branchId: 'cn:1:c' },
    //        { classes: ['text-muted-foreground'], branchId: 'cn:1:a' }]
    // 両方の text 候補と bg が組合せ対象になる (無条件 bg は全分岐で適用)
    const stack = makeStack(
      [[{ classes: ['bg-background'] }]], // branchId=undefined
      [
        { classes: ['text-foreground'], branchId: 'cn:1:c' },
        { classes: ['text-muted-foreground'], branchId: 'cn:1:a' },
      ],
    );
    const result = classifyStack(stack, cssVars);
    // bg-background は両 text 候補と互換 → 2 通りが評価される → resolvable
    expect(result.kind).toBe('resolvable');
  });

  it('mixed: parent bg (branchId=undefined) + current bg alternatives (branchId set) filtered correctly', () => {
    // 親要素 bg-background (branchId=undefined) + 現要素 cn(cond ? 'bg-card' : 'bg-muted')
    // bgStack: [
    //   [{ classes: ['bg-background'], branchId: undefined }],    ← 層1: 親 (常に互換)
    //   [{ classes: ['bg-card'], branchId: 'cn:0:c' },           ← 層2: 子の alternative 分岐
    //    { classes: ['bg-muted'], branchId: 'cn:0:a' }],
    // ]
    // textCandidates: [
    //   { classes: ['text-foreground'], branchId: 'cn:0:c' },
    //   { classes: ['text-muted-foreground'], branchId: 'cn:0:a' },
    // ]
    // bg paths: [bg-background + bg-card] or [bg-background + bg-muted]
    // text 'cn:0:c' と互換なパス: bg-background(undefined) + bg-card(cn:0:c) → compat
    // text 'cn:0:a' と互換なパス: bg-background(undefined) + bg-muted(cn:0:a) → compat
    const stack = makeStack(
      [
        [{ classes: ['bg-background'], branchId: undefined }],
        [
          { classes: ['bg-card'], branchId: 'cn:0:c' },
          { classes: ['bg-muted'], branchId: 'cn:0:a' },
        ],
      ],
      [
        { classes: ['text-foreground'], branchId: 'cn:0:c' },
        { classes: ['text-muted-foreground'], branchId: 'cn:0:a' },
      ],
    );
    const result = classifyStack(stack, cssVars);
    // 全組合せが resolvable なクラスで構成される → resolvable
    expect(result.kind).toBe('resolvable');
  });
});

// ---------------------------------------------------------------------------
// P1 修正 (PR #806 Codex P1): 階層 bgStack で排他的 bg 分岐を独立評価
// ---------------------------------------------------------------------------

describe('P1: hierarchical bgStack evaluates exclusive bg branches as separate combinations', () => {
  // シナリオ: <div className={cn(cond ? 'bg-black' : 'bg-white')}><p className="text-black">
  // 旧実装: bgStack が flat → text(undefined) が bg-black と bg-white 両方と互換
  //   → bg-black + bg-white を同時 compositeOver → 誤った合成色。bg-black + text-black が検出されない
  // 新実装: bgStack が [[{bg-black, cn:0:c}, {bg-white, cn:0:a}]] (1 層 2 alternative)
  //   → 組合せ1: bg-black + text-black → ratio ≈ 1 (AA 未満) → 最悪ケースとして検出
  //   → 組合せ2: bg-white + text-black → ratio ≈ 21 (AA クリア)
  //   → worst-case は ratio ≈ 1 → 違反として検出

  it('exclusive bg branch: bg-black + text-black fails AA (not masked by bg-white)', () => {
    // text-black (undefined branchId) は bg-black と bg-white 両方の alternative と評価される
    // 旧実装では両 bg を同時合成して誤った中間色になり、bg-black + text-black が見落とされた
    const stack = makeStack(
      [
        [
          { classes: ['bg-black'], branchId: 'cn:0:c' },
          { classes: ['bg-white'], branchId: 'cn:0:a' },
        ],
      ],
      [
        { classes: ['text-black'] }, // branchId=undefined → 両 alternative と組合せ
      ],
    );
    const result = classifyStack(stack, cssVars);
    // bg-black + text-black は ratio ≈ 1 (AA 未満) → resolvable だが worst-case は低コントラスト
    // bg-white + text-black は ratio ≈ 21 (AA クリア) → worst-case は bg-black ペアの ratio
    // 両組合せの worst を取るので bg-black + text-black ペアが採用される → 低コントラスト
    expect(result.kind).toBe('resolvable');
    if (result.kind === 'resolvable') {
      // bg-black (r≈0) + text-black (r≈0) → worst-case の ratio は < 1.05 (ほぼ同色)
      // classify は worst-case (最低コントラスト比) のペアを返す
      const lightBg = result.themes.light.bg;
      const lightFg = result.themes.light.fg;
      // worst-case のペア: bg-black + text-black → bg と fg がともに黒に近い
      // (bg-white + text-black との比較で、より低コントラストな bg-black + text-black が採用される)
      // bg.r が 0.1 未満 (黒) の場合: bg-black + text-black ペアが worst-case
      // fg.r が 0.1 未満 (黒): text-black
      // この組合せでは bg と fg ともに暗色 → 低コントラスト
      expect(lightBg.r).toBeLessThan(0.5);
      expect(lightFg.r).toBeLessThan(0.5);
    }
  });

  it('hierarchical bgStack: grandparent bg + parent alternative bg = Cartesian product combinations', () => {
    // bgStack: [[{bg-background, undefined}], [{bg-black, cn:0:c}, {bg-white, cn:0:a}]]
    // bg paths: [bg-background + bg-black], [bg-background + bg-white]
    // text: [{text-black, undefined}]
    // 組合せ1: bg-background(上) + bg-black(下) + text-black → 黒地に黒 → ratio≈1
    // 組合せ2: bg-background(上) + bg-white(下) + text-black → 白地に黒 → ratio≈21
    // worst-case は ratio≈1 のペア → resolvable だが低コントラスト
    const stack = makeStack(
      [
        [{ classes: ['bg-background'] }], // 層1: 祖父 bg (無条件)
        [
          { classes: ['bg-black'], branchId: 'cn:0:c' },
          { classes: ['bg-white'], branchId: 'cn:0:a' },
        ], // 層2: 親の alternative 分岐
      ],
      [{ classes: ['text-black'] }], // branchId=undefined → 両 bg パスと組合せ
    );
    const result = classifyStack(stack, cssVars);
    // 2 通りの組合せが生成され、全て resolvable なクラス → resolvable
    expect(result.kind).toBe('resolvable');
    if (result.kind === 'resolvable') {
      // worst-case は bg-background + bg-black + text-black (ratio≈1) のペア
      // bg + fg ともに暗色方向
      expect(result.themes.light.bg).toBeDefined();
      expect(result.themes.light.fg).toBeDefined();
    }
  });

  it('same-element cn() alternatives within one layer do not compositeOver each other', () => {
    // cn(cond ? 'bg-black' : 'bg-white') は 2 alternative で、
    // それぞれが独立に text と組み合わされる。
    // 旧実装では両 bg を compositeOver して中間色 (グレー) になり、
    // どちらの分岐でも文字が読めるかのような誤判定をしていた。
    const stack = makeStack(
      [
        [
          { classes: ['bg-black'], branchId: 'cn:0:c' },
          { classes: ['bg-white'], branchId: 'cn:0:a' },
        ],
      ],
      [{ classes: ['text-white'], branchId: 'cn:0:c' }],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('resolvable');
    if (result.kind === 'resolvable') {
      // text-white (cn:0:c) と互換な bg は bg-black (cn:0:c) のみ
      // bg-black + text-white → ratio≈21 → AA クリア → worst-case も高コントラスト
      const lightBg = result.themes.light.bg;
      // bg-black (r≈0) が選ばれるはず (bg-white と text-white は cn:0:a vs cn:0:c で非互換)
      expect(lightBg.r).toBeLessThan(0.1);
    }
  });
});
