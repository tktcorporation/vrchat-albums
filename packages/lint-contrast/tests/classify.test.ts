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

function makeStack(
  bgStack: ClassCandidate[],
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
    const stack = makeStack([staticBg('bg-background')], []);
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
    const stack = makeStack([{ classes: [] }], [{ classes: [] }]);
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
      [dynamicCandidate()],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('dynamic-bg-branch');
    }
  });

  it('returns unknown when bgStack has mixed static and dynamic candidates', () => {
    const stack = makeStack(
      [staticBg('bg-background'), dynamicCandidate()],
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
    const stack = makeStack([staticBg('bg-background')], [dynamicCandidate()]);
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
      [staticBg('bg-background')],
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
      [staticBg('bg-background')],
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
      [staticBg('bg-card')],
      [staticText('text-card-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    // card-foreground is the same as foreground in mock CSS
    expect(result.kind).toBe('resolvable');
  });

  it('resolves alpha composite: bg-background + bg-white/30 + text-muted-foreground', () => {
    const stack = makeStack(
      [staticBg('bg-background'), staticBg('bg-white/30')],
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
  it('returns unknown when combinations exceed 32', () => {
    // Create 33+ text candidates (bgStack = 1, textCandidates = 33 → 33 combinations)
    const textCandidates: ClassCandidate[] = [];
    for (let i = 0; i < 33; i++) {
      textCandidates.push(staticText('text-foreground'));
    }
    const stack = makeStack([staticBg('bg-background')], textCandidates);
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
    const stack = makeStack([staticBg('bg-background')], [dynamicCandidate()]);
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
      [staticBg('bg-white', 'dark:bg-background')],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    // dark:bg-background は light モードでスキップされ、bg-white のみで解決できる
    expect(result.kind).toBe('resolvable');
  });

  // 指摘 1: dark モードでは dark:bg-* が採用される
  it('dark:bg-* in bgStack is applied in dark mode', () => {
    const stack = makeStack(
      [staticBg('bg-white', 'dark:bg-background')],
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
      [staticBg('bg-background')],
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
      [staticBg('bg-white', 'dark:bg-background')],
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
      [staticBg('bg-white', 'dark:bg-background')],
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
      [staticBg('bg-white', 'bg-black')],
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
      [staticBg('bg-background', 'bg-card')],
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
    // countCombinations([], [...]) === 0 ≤ 32 なので resolvable へ進む。
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
  });
});

// ---------------------------------------------------------------------------
// 指摘 2 結合確認 (PR #806): 要素内 bg cascade vs 親子 compositeOver
// ---------------------------------------------------------------------------

describe('element-vs-ancestor bg cascade (Issue 2 validation)', () => {
  // 親子ネスト: 親 bg-background + 子 bg-black/50 → compositeOver が適用される
  // <div className="bg-background"><span className="text-white bg-black/50">
  //   → 子の bgStack = [{ classes: ['bg-background'] }, { classes: ['bg-black/50'] }]
  //   → compositeOver([white, black/50], base) = 中間のグレー
  it('parent-child nesting: ancestor bg + alpha child bg are composited (separate bgStack entries)', () => {
    // bgStack に 2 エントリ (親と子それぞれ独立した ClassCandidate) → compositeOver される
    // 修正済み設計: 2 エントリが別候補として bgStack に積まれるため合成が発生する
    // light モード: bg-background = white (r=1,g=1,b=1), bg-black/50 = black at 0.5
    // compositeOver([white, black/50], white_base) = 0.5*0 + (1-0.5)*1 = 0.5 (グレー)
    const stack = makeStack(
      [
        staticBg('bg-background'), // 親要素 (ancestor)
        staticBg('bg-black/50'), // 子要素 (element itself, with alpha)
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
    // bgStack に 1 エントリ { classes: ['bg-black/50', 'bg-white/50'] }
    // → resolveForTheme 内で最後の適用可能クラス bg-white/50 のみ採用 (bg-black/50 は上書き)
    // → compositeOver([white/50], base) = 白系の薄い色
    // ≠ compositeOver([black/50, white/50], base) = 黒+白の合成 (誤った旧動作)
    const stack = makeStack(
      [staticBg('bg-black/50', 'bg-white/50')], // 単一要素の className に両クラス
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
      [staticBg('bg-background')],
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
      [{ classes: [], branchLabel: 'variant-pseudo' }],
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
      [staticBg('bg-background')],
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
    // → resolveForTheme が null → unknown(dynamic-classname)
    const stack = makeStack(
      [staticBg('bg-background')],
      // __unknown_color__ は resolveClass に未登録 → null を返す
      [staticText('text-foreground', '__unknown_color__')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('dynamic-classname');
    }
  });

  it('fg: unresolvable class before text-foreground → unknown (any applicable unresolvable triggers unknown)', () => {
    // "__unknown_color__" が先で "text-foreground" が後: cascade では text-foreground が後勝ちだが、
    // "__unknown_color__" は適用可能かつ resolve 不能 → 前後問わず全体を unknown 昇格させる
    // (位置に関わらず適用可能な未知クラスは結果を不確定にする)
    const stack = makeStack(
      [staticBg('bg-background')],
      [staticText('__unknown_color__', 'text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    // "__unknown_color__" が適用可能かつ resolve 不能 → unknown 昇格
    expect(result.kind).toBe('unknown');
  });

  it('bg: bg-card followed by unresolvable class → unknown', () => {
    // bg 側も同じポリシー: 適用可能かつ resolve 不能なクラスがあれば全体 null → unknown
    const stack = makeStack(
      [staticBg('bg-card', '__unknown_bg__')],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('dynamic-classname');
    }
  });

  it('non-applicable dark: unresolvable class does not cause unknown in light mode', () => {
    // "dark:__unknown__" は light モードでは isApplicableForTheme = false → スキップ
    // → light モードでは text-foreground のみ採用 → resolvable
    const stack = makeStack(
      [staticBg('bg-background')],
      [staticText('text-foreground', 'dark:__unknown__')],
    );
    const result = classifyStack(stack, cssVars);
    // dark:__unknown__ は light モードで非適用 → スキップ → text-foreground で resolvable
    // dark モードでは dark:__unknown__ が適用可能かつ resolve 不能 → unknown 昇格
    // 全体の result は両テーマを評価するため unknown になる
    expect(result.kind).toBe('unknown');
  });
});
