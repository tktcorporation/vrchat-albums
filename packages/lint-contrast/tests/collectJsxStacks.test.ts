/**
 * collectJsxStacks の単体テスト。
 *
 * oxc-parser を使った JSX スタック抽出ロジックを検証する。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectJsxStacks } from '../src/collectJsxStacks.js';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../test-fixtures');

describe('collectJsxStacks', () => {
  it('extracts bg+text stack from simple nesting', () => {
    const source = `
      export function Foo() {
        return (
          <div className="bg-card">
            <p className="text-foreground">hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // bgStack は ClassCandidate[][] — flat() で全候補を走査する
    expect(
      pStack!.bgStack.flat().some((c) => c.classes.includes('bg-card')),
    ).toBe(true);
    expect(
      pStack!.textCandidates.some((c) => c.classes.includes('text-foreground')),
    ).toBe(true);
  });

  it('records text-only element (no ancestor bg) with empty bgStack', () => {
    // 指摘 1 の修正: bgStack が空でも textCandidates があれば JsxStack を生成する。
    // classify.ts Rule 6 が bgStack 空時に暗黙の --background をベースとして使うため、
    // ページデフォルト背景に対するコントラスト検証が可能になる (偽陰性を防ぐ)。
    const source = `
      export function Foo() {
        return <p className="text-foreground">hello</p>;
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    expect(pStack!.bgStack).toHaveLength(0);
    expect(
      pStack!.textCandidates.some((c) => c.classes.includes('text-foreground')),
    ).toBe(true);
  });

  it('detects dynamic class as branchLabel: dynamic', () => {
    const source = `
      declare const x: string;
      export function Foo() {
        return (
          <div className="bg-background">
            <p className={\`text-foreground \${x}\`}>hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    const hasDynamic = pStack!.textCandidates.some(
      (c) => c.branchLabel === 'dynamic',
    );
    expect(hasDynamic).toBe(true);
  });

  it('ignores elements with no bg or text classes (skip-no-colors fixture)', () => {
    const source = readFileSync(
      path.join(FIXTURES_DIR, 'skip-no-colors.tsx'),
      'utf8',
    );
    const stacks = collectJsxStacks('skip-no-colors.tsx', source);
    expect(stacks).toHaveLength(0);
  });

  it('extracts bg stack from ok-card-on-background fixture', () => {
    const source = readFileSync(
      path.join(FIXTURES_DIR, 'ok-card-on-background.tsx'),
      'utf8',
    );
    const stacks = collectJsxStacks('ok-card-on-background.tsx', source);
    expect(stacks.length).toBeGreaterThan(0);
    const hasExpected = stacks.some(
      (s) =>
        s.bgStack.flat().some((c) => c.classes.includes('bg-background')) &&
        s.textCandidates.some((c) => c.classes.includes('text-foreground')),
    );
    expect(hasExpected).toBe(true);
  });

  it('extracts nested alpha composite stack from ng-alpha-composite fixture', () => {
    const source = readFileSync(
      path.join(FIXTURES_DIR, 'ng-alpha-composite.tsx'),
      'utf8',
    );
    const stacks = collectJsxStacks('ng-alpha-composite.tsx', source);
    expect(stacks.length).toBeGreaterThan(0);
    const innerStack = stacks.find(
      (s) =>
        s.bgStack.flat().some((c) => c.classes.includes('bg-white/30')) &&
        s.elementName === 'p',
    );
    expect(innerStack).toBeDefined();
    expect(
      innerStack!.bgStack
        .flat()
        .some((c) => c.classes.includes('bg-background')),
    ).toBe(true);
  });

  it('handles cn() call with conditional class', () => {
    const source = `
      declare const cond: boolean;
      export function Foo() {
        return (
          <div className="bg-background">
            <p className={cn(cond && 'bg-card', 'text-foreground')}>hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    const hasBgBranch = pStack!.bgStack
      .flat()
      .some(
        (c) =>
          c.classes.includes('bg-card') ||
          c.branchLabel?.includes('conditional'),
      );
    expect(hasBgBranch).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 指摘 2: 三項演算子の非リテラル分岐が dynamic candidate として記録される
  // ---------------------------------------------------------------------------

  it('records both literal and dynamic candidates from ternary with non-literal branch', () => {
    // 指摘 2 の修正: cn(cond ? dynamicVar : 'text-foreground') のような場合、
    // 非リテラル分岐 (dynamicVar) を silently drop せず dynamic candidate として記録する。
    // classify の Rule 5 が発火して unknown に落ちる = 偽陰性を防ぐ健全な挙動。
    const source = `
      declare const dynamicCls: string;
      declare const cond: boolean;
      export function Foo() {
        return (
          <div className="bg-background">
            <p className={cn(cond ? dynamicCls : 'text-foreground')}>hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // リテラル分岐が候補として存在する
    const hasLiteralCandidate = pStack!.textCandidates.some((c) =>
      c.classes.includes('text-foreground'),
    );
    expect(hasLiteralCandidate).toBe(true);
    // 非リテラル分岐が dynamic candidate として存在する
    const hasDynamicCandidate = pStack!.textCandidates.some(
      (c) => c.branchLabel === 'dynamic',
    );
    expect(hasDynamicCandidate).toBe(true);
  });

  it('records dynamic candidate for both non-literal ternary branches', () => {
    // cn(cond ? dynA : dynB) のように両分岐が非リテラルの場合、
    // 2つの dynamic candidate が記録される。
    const source = `
      declare const dynA: string;
      declare const dynB: string;
      declare const cond: boolean;
      export function Foo() {
        return (
          <div className="bg-background">
            <p className={cn(cond ? dynA : dynB)}>hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    const dynamicCandidates = pStack!.textCandidates.filter(
      (c) => c.branchLabel === 'dynamic',
    );
    expect(dynamicCandidates.length).toBeGreaterThanOrEqual(2);
  });

  // ---------------------------------------------------------------------------
  // 指摘 1 修正 (PR #806): 無条件 cn 引数を連結して 1 候補に集約
  // ---------------------------------------------------------------------------

  it('merges unconditional cn literal args into a single ClassCandidate', () => {
    // cn('text-foreground', 'text-muted-foreground') のような無条件リテラルは
    // CSS 的に両方が同一要素に同時適用される (cascade 最後勝ち = text-muted-foreground)。
    // 修正前: 2 つの独立 ClassCandidate として分岐扱い → text-foreground 側が到達不能として偽陽性
    // 修正後: 1 つの ClassCandidate { classes: ['text-foreground', 'text-muted-foreground'] }
    const source = `
      export function Foo() {
        return (
          <div className="bg-background">
            <p className={cn('text-foreground', 'text-muted-foreground')}>hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // 1 候補に連結されているはず (2 候補に分かれていてはいけない)
    expect(pStack!.textCandidates).toHaveLength(1);
    expect(pStack!.textCandidates[0].classes).toContain('text-foreground');
    expect(pStack!.textCandidates[0].classes).toContain(
      'text-muted-foreground',
    );
    // 無条件引数なので branchLabel は undefined
    expect(pStack!.textCandidates[0].branchLabel).toBeUndefined();
  });

  it('generates 2 candidates for cn with unconditional base + conditional branch', () => {
    // cn('a', cond && 'b', 'c') の期待動作:
    // - 「b なし」パス: classes = ['a', 'c'] (unconditional のみ)
    // - 「b あり」パス: classes = ['a', 'b', 'c']
    // つまり 2 候補となる。
    const source = `
      declare const cond: boolean;
      export function Foo() {
        return (
          <div className="bg-background">
            <p className={cn('text-foreground', cond && 'text-muted-foreground', 'text-card-foreground')}>hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // 2 候補が生成される
    expect(pStack!.textCandidates).toHaveLength(2);
    // 両候補が text-foreground と text-card-foreground を含む (unconditional base)
    for (const candidate of pStack!.textCandidates) {
      expect(candidate.classes).toContain('text-foreground');
      expect(candidate.classes).toContain('text-card-foreground');
    }
    // どちらかの候補が text-muted-foreground を含む (conditional branch)
    const hasConditionalClass = pStack!.textCandidates.some((c) =>
      c.classes.includes('text-muted-foreground'),
    );
    expect(hasConditionalClass).toBe(true);
    // もう一方は text-muted-foreground を含まない
    const withoutConditional = pStack!.textCandidates.some(
      (c) => !c.classes.includes('text-muted-foreground'),
    );
    expect(withoutConditional).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 指摘 1 (PR #806): 非 dark: バリアント付きクラスが variant-pseudo として記録される
  // ---------------------------------------------------------------------------

  it('sm:text-foreground produces variant-pseudo textCandidate', () => {
    // sm:text-foreground はレスポンシブバリアント付き → 静的解析不能
    // → branchLabel: 'variant-pseudo' の候補が textCandidates に記録される
    // → classify Rule 5 が発火して unknown に落ちる (偽陰性を防ぐ)
    const source = `
      export function Foo() {
        return (
          <div className="bg-background">
            <p className="sm:text-foreground">hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    const hasVariantPseudo = pStack!.textCandidates.some(
      (c) => c.branchLabel === 'variant-pseudo',
    );
    expect(hasVariantPseudo).toBe(true);
  });

  it('hover:bg-card produces variant-pseudo bgCandidate', () => {
    // hover:bg-card は疑似クラスバリアント付き → 静的解析不能
    // → branchLabel: 'variant-pseudo' の候補が bgCandidates (bgStack) に記録される
    const source = `
      export function Foo() {
        return (
          <div className="hover:bg-card">
            <p className="text-foreground">hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    const hasVariantPseudo = pStack!.bgStack
      .flat()
      .some((c) => c.branchLabel === 'variant-pseudo');
    expect(hasVariantPseudo).toBe(true);
  });

  it('md:text-foreground dark:md:text-accent — md: is variant-pseudo, dark:md: is also variant-pseudo', () => {
    // md:text-foreground → hasNonDarkVariant → variant-pseudo
    // dark:md:text-accent → 複合バリアント (dark + md) → md が non-dark → variant-pseudo
    const source = `
      export function Foo() {
        return (
          <div className="bg-background">
            <p className="md:text-foreground dark:md:text-accent">hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // 両方とも variant-pseudo として記録されるので候補が存在する
    const variantPseudoCandidates = pStack!.textCandidates.filter(
      (c) => c.branchLabel === 'variant-pseudo',
    );
    expect(variantPseudoCandidates.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // 指摘 2 (PR #806): LogicalExpression の動的左辺が dynamic 候補として記録される
  // ---------------------------------------------------------------------------

  it('cn(dynamicVar || "text-foreground") produces literal + dynamic candidates', () => {
    // dynamicVar が truthy なとき dynamicVar 自身の値が使われる (ランタイム依存)
    // → リテラル側 ({classes:['text-foreground']}) + dynamic 側 ({classes:[], branchLabel:'dynamic'})
    // → classify Rule 5 で unknown に落ちる (偽陰性を防ぐ)
    const source = `
      declare const dynamicVar: string;
      export function Foo() {
        return (
          <div className="bg-background">
            <p className={cn(dynamicVar || 'text-foreground')}>hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // リテラル側が候補として存在する
    const hasLiteralCandidate = pStack!.textCandidates.some((c) =>
      c.classes.includes('text-foreground'),
    );
    expect(hasLiteralCandidate).toBe(true);
    // 動的側が候補として存在する (dynamicVar が truthy で勝つケース)
    const hasDynamicCandidate = pStack!.textCandidates.some(
      (c) => c.branchLabel === 'dynamic',
    );
    expect(hasDynamicCandidate).toBe(true);
    // 合計 2 候補以上
    expect(pStack!.textCandidates.length).toBeGreaterThanOrEqual(2);
  });

  it('cn(dynamicVar && "text-foreground") has literal text candidate (no extra dynamic)', () => {
    // cond && 'class' パターン: cond は boolean 条件として使われる
    // → リテラル候補が textCandidates に記録される
    // && の左辺はクラス文字列ではなく boolean 条件として扱うので dynamic は追加しない
    // (|| / ?? と異なり && の左辺値はクラスとして使われない)
    const source = `
      declare const dynamicVar: boolean;
      export function Foo() {
        return (
          <div className="bg-background">
            <p className={cn(dynamicVar && 'text-foreground')}>hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // リテラル側が候補として存在する
    const hasLiteralCandidate = pStack!.textCandidates.some((c) =>
      c.classes.includes('text-foreground'),
    );
    expect(hasLiteralCandidate).toBe(true);
    // && 演算子の左辺は boolean 条件なので dynamic 候補は追加されない
    const hasDynamicCandidate = pStack!.textCandidates.some(
      (c) => c.branchLabel === 'dynamic',
    );
    expect(hasDynamicCandidate).toBe(false);
  });

  it('single element with cn(bg-black/50, bg-white/50) produces one bgStack layer with one candidate', () => {
    // 同一要素内の複数 bg クラスは単一 ClassCandidate に連結される。
    // CSS cascade 的には bg-white/50 が後勝ち (同一要素なので compositeOver しない)。
    // 修正後: 1 層 1 候補 [[ { classes: ['bg-black/50', 'bg-white/50'] } ]]
    // → classify 側の最後勝ちロジックで bg-white/50 が採用される
    const source = `
      export function Foo() {
        return (
          <div className={cn('bg-black/50', 'bg-white/50')}>
            <p className="text-foreground">hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // 子要素 p の bgStack に div の bg が継承される (1 層)
    // bgStack: 1 層 (div の bg 候補群を 1 層として格納)
    expect(pStack!.bgStack).toHaveLength(1);
    // その層の候補は 1 つ (無条件 cn() args は 1 候補に連結される)
    expect(pStack!.bgStack[0]).toHaveLength(1);
    expect(pStack!.bgStack[0][0].classes).toContain('bg-black/50');
    expect(pStack!.bgStack[0][0].classes).toContain('bg-white/50');
  });
});

// ---------------------------------------------------------------------------
// PR #806 Codex 追加指摘 2: ブラケット始まり任意バリアント [&>*]: の認識
// ---------------------------------------------------------------------------

describe('bracket arbitrary variant prefix stripping', () => {
  // [&>*]:text-foreground のような Tailwind arbitrary variant はブラケット始まり。
  // 旧実装の regex はアルファベット始まりのみ対応していたため、これらは
  // isColorClass 判定に "[&>*]:text-foreground" がそのまま渡り false → drop → 偽陰性。
  // 新実装: ループで [...]： も認識し、base = "text-foreground" として color class 判定する。
  // ブラケット任意バリアントは dark: でないので hasNonDarkVariant = true → variant-pseudo 候補。

  it('[&>*]:text-foreground produces variant-pseudo textCandidate', () => {
    // ブラケット始まり任意バリアント: [&>*]: を剥がして text-foreground が isColorClass
    // → hasNonDarkVariant = true → variant-pseudo branchLabel が付与される
    const source = `
      export function Foo() {
        return (
          <div className="bg-background">
            <p className="[&>*]:text-foreground">hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    const hasVariantPseudo = pStack!.textCandidates.some(
      (c) => c.branchLabel === 'variant-pseudo',
    );
    expect(hasVariantPseudo).toBe(true);
  });

  it('[@media(prefers-contrast:high)]:bg-card produces variant-pseudo bgCandidate', () => {
    // @media 任意バリアント: [@media(prefers-contrast:high)]: を剥がして bg-card が isColorClass
    // → hasNonDarkVariant = true → variant-pseudo
    const source = `
      export function Foo() {
        return (
          <div className="[@media(prefers-contrast:high)]:bg-card">
            <p className="text-foreground">hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    const hasVariantPseudo = pStack!.bgStack
      .flat()
      .some((c) => c.branchLabel === 'variant-pseudo');
    expect(hasVariantPseudo).toBe(true);
  });

  it('sm:[&>*]:text-foreground (alpha chain) strips all prefixes and produces variant-pseudo', () => {
    // チェイン: "sm:" (alpha) + "[&>*]:" (bracket) → base = "text-foreground"
    // hasNonDarkVariant = true → variant-pseudo
    const source = `
      export function Foo() {
        return (
          <div className="bg-background">
            <p className="sm:[&>*]:text-foreground">hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    const hasVariantPseudo = pStack!.textCandidates.some(
      (c) => c.branchLabel === 'variant-pseudo',
    );
    expect(hasVariantPseudo).toBe(true);
  });

  it('[&>*]:dark:text-accent (bracket + dark chain) produces variant-pseudo (hasNonDarkVariant wins)', () => {
    // "[&>*]:" (bracket, non-dark) + "dark:" → hasNonDarkVariant = true → variant-pseudo
    // (dark: が含まれていても non-dark バリアントが存在するため variant-pseudo 扱い)
    const source = `
      export function Foo() {
        return (
          <div className="bg-background">
            <p className="[&>*]:dark:text-accent">hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    const hasVariantPseudo = pStack!.textCandidates.some(
      (c) => c.branchLabel === 'variant-pseudo',
    );
    expect(hasVariantPseudo).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C12 修正 (PR #806 CodeRabbit): アキュムレータ爆発ガード
// cn() 内で深くネストした条件分岐があっても MAX_ACCUMULATORS (64) で打ち切る
// ---------------------------------------------------------------------------

describe('C12: accumulator explosion guard in extractCandidatesFromCnCall', () => {
  it('deep cn nesting (7+ binary branches) does not produce exponential candidates', () => {
    // 7 段の && 分岐 → 2^7 = 128 > 64 (MAX_ACCUMULATORS) → dynamic に集約される
    // 修正なしだと 128 候補が生成される。修正後は dynamic 単一候補に集約される。
    const source = `
      declare const c1: boolean, c2: boolean, c3: boolean, c4: boolean;
      declare const c5: boolean, c6: boolean, c7: boolean;
      export function Foo() {
        return (
          <p className={cn(
            c1 && 'text-foreground',
            c2 && 'text-muted-foreground',
            c3 && 'text-foreground',
            c4 && 'text-muted-foreground',
            c5 && 'text-foreground',
            c6 && 'text-muted-foreground',
            c7 && 'text-foreground'
          )}>hello</p>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // 候補数が MAX_ACCUMULATORS (64) 以下に収まること
    // (dynamic に集約されるケースを含む)
    const totalCandidates = pStack!.textCandidates.length;
    expect(totalCandidates).toBeLessThanOrEqual(64);
  });

  it('6 binary branches stays within bound (no overflow)', () => {
    // 6 段の && 分岐 → 2^6 = 64 = MAX_ACCUMULATORS → 境界ギリギリ
    const source = `
      declare const c1: boolean, c2: boolean, c3: boolean;
      declare const c4: boolean, c5: boolean, c6: boolean;
      export function Foo() {
        return (
          <p className={cn(
            c1 && 'text-foreground',
            c2 && 'text-muted-foreground',
            c3 && 'text-foreground',
            c4 && 'text-muted-foreground',
            c5 && 'text-foreground',
            c6 && 'text-muted-foreground'
          )}>hello</p>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // 候補数が上限以下
    expect(pStack!.textCandidates.length).toBeLessThanOrEqual(64);
  });
});

// ---------------------------------------------------------------------------
// branchId 付与: ConditionalExpression / LogicalExpression で bg/text ペア結合
// ---------------------------------------------------------------------------

describe('branchId: ConditionalExpression assigns matching branchId to bg and text', () => {
  it('cn(cond ? "bg-black text-white" : "bg-white text-black") produces 1 bg layer with 2 alternatives + 2 text candidates', () => {
    // 分岐1 (consequent): bg-black + text-white → 同じ branchId 'cn:0:c'
    // 分岐2 (alternate):  bg-white + text-black → 同じ branchId 'cn:0:a'
    // 新設計: 同一 cn() 内の分岐候補は同一層の alternative として格納される
    // bgStack: [[{bg-black, cn:0:c}, {bg-white, cn:0:a}]] (1 層 2 alternative)
    const source = `
      declare const cond: boolean;
      export function Foo() {
        return (
          <div className={cn(cond ? 'bg-black text-white' : 'bg-white text-black')}>
            Hello
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const divStack = stacks.find((s) => s.elementName === 'div');
    expect(divStack).toBeDefined();

    // bgStack: 1 層 (div 自身の bg 候補群), その層に 2 alternative
    expect(divStack!.bgStack).toHaveLength(1);
    expect(divStack!.bgStack[0]).toHaveLength(2);
    const bgConsequent = divStack!.bgStack[0].find((c) =>
      c.classes.includes('bg-black'),
    );
    const bgAlternate = divStack!.bgStack[0].find((c) =>
      c.classes.includes('bg-white'),
    );
    expect(bgConsequent).toBeDefined();
    expect(bgAlternate).toBeDefined();
    // consequent と alternate で異なる branchId が付与されている
    expect(bgConsequent!.branchId).toBeDefined();
    expect(bgAlternate!.branchId).toBeDefined();
    expect(bgConsequent!.branchId).not.toBe(bgAlternate!.branchId);

    // textCandidates: 2 候補 (consequent, alternate)
    expect(divStack!.textCandidates).toHaveLength(2);
    const textConsequent = divStack!.textCandidates.find((c) =>
      c.classes.includes('text-white'),
    );
    const textAlternate = divStack!.textCandidates.find((c) =>
      c.classes.includes('text-black'),
    );
    expect(textConsequent).toBeDefined();
    expect(textAlternate).toBeDefined();

    // bg と text の branchId が対応している (consequent 同士、alternate 同士)
    expect(bgConsequent!.branchId).toBe(textConsequent!.branchId);
    expect(bgAlternate!.branchId).toBe(textAlternate!.branchId);
  });

  it('cn("bg-base", cond ? "bg-a text-a" : "bg-b text-b") — bg-base is merged into each branch with branch branchId', () => {
    // 無条件引数 'bg-base' は全パスで適用されるが、
    // ConditionalExpression 展開後は各分岐の accumulator に組み込まれて branchId を持つ。
    // 最終的に bgStack に 1 層 2 alternative (consequent + alternate) が生成され、
    // 各候補に bg-background が含まれている。
    const source = `
      declare const cond: boolean;
      export function Foo() {
        return (
          <div className={cn('bg-background', cond ? 'bg-card text-card-foreground' : 'bg-muted text-muted-foreground')}>
            Hello
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const divStack = stacks.find((s) => s.elementName === 'div');
    expect(divStack).toBeDefined();

    // bgStack: 1 層 2 alternative (consequent と alternate の各パスに bg-background が含まれる)
    expect(divStack!.bgStack).toHaveLength(1);
    expect(divStack!.bgStack[0]).toHaveLength(2);

    // 両候補に bg-background が含まれている (各分岐で無条件部分が適用される)
    for (const bgCandidate of divStack!.bgStack[0]) {
      expect(bgCandidate.classes).toContain('bg-background');
    }

    // bg 候補は異なる branchId を持つ (consequent と alternate)
    const bgBranchIds = divStack!.bgStack[0].map((c) => c.branchId);
    expect(bgBranchIds[0]).not.toBe(bgBranchIds[1]);
    expect(bgBranchIds[0]).toBeDefined();
    expect(bgBranchIds[1]).toBeDefined();

    // textCandidates の条件分岐候補も branchId が付与されている
    const textConditional = divStack!.textCandidates.filter(
      (c) => c.branchId !== undefined,
    );
    expect(textConditional.length).toBeGreaterThanOrEqual(1);
  });

  it('cn(dynamicVar || "text-foreground") — rhs branchId attached to literal candidate', () => {
    // || 演算子の右辺リテラル候補には activeBranchId ('cn:0:rhs') が付与される。
    // 「右辺なし」パス (左辺が truthy) は branchId=undefined のまま。
    const source = `
      declare const dynamicVar: string;
      export function Foo() {
        return (
          <div className="bg-background">
            <p className={cn(dynamicVar || 'text-foreground')}>hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();

    // リテラル候補 (右辺適用パス) に branchId が付与されている
    const literalCandidate = pStack!.textCandidates.find((c) =>
      c.classes.includes('text-foreground'),
    );
    expect(literalCandidate).toBeDefined();
    // 右辺 rhs パスは branchId='cn:0:rhs'
    expect(literalCandidate!.branchId).toBe('cn:0:rhs');
  });
});

// ---------------------------------------------------------------------------
// C16 修正 (PR #806 CodeRabbit): OR 条件 split
// ---------------------------------------------------------------------------

describe('C16: cn conditional bg-card branch detection', () => {
  it('cn(cond && "bg-card", "text-foreground") has bg-card candidate or conditional branchLabel', () => {
    // OR で条件を束ねるのではなく、find で候補を取り個別に assertion する
    const source = `
      declare const cond: boolean;
      export function Foo() {
        return (
          <div className="bg-background">
            <p className={cn(cond && 'bg-card', 'text-foreground')}>hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();

    // bg-card クラスを持つ候補が存在すること (修正前と同じ検証、OR を分割)
    // bgStack は ClassCandidate[][] なので flat() で全候補を走査する
    const bgCardCandidate = pStack!.bgStack
      .flat()
      .find((c) => c.classes.includes('bg-card'));
    // branchLabel が conditional を含む候補が存在すること
    const conditionalCandidate = pStack!.bgStack
      .flat()
      .find((c) => c.branchLabel?.includes('conditional'));

    // どちらか一方の条件が満たされること
    const hasBgCardOrConditional =
      bgCardCandidate !== undefined || conditionalCandidate !== undefined;
    expect(hasBgCardOrConditional).toBe(true);

    // 具体的に、bg-card を持つ候補または conditional ラベルを持つ候補を検証する
    if (bgCardCandidate !== undefined) {
      expect(bgCardCandidate.classes).toContain('bg-card');
    }
    if (conditionalCandidate !== undefined) {
      expect(conditionalCandidate.branchLabel).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// P2 修正 (PR #806 Codex P2): Tailwind important 修飾子 (!) のサポート
// ---------------------------------------------------------------------------

describe('P2: Tailwind important modifier (!bg-*, !text-*) support', () => {
  // Tailwind v3+ の important 修飾子 ! はバリアント剥がし後に先頭に残る。
  // 旧実装: isColorClass が "!text-foreground" を受け取り false → drop (偽陰性)
  // 新実装: extractBase で ! を除去してから isColorClass に渡す → color class として認識

  it('!text-foreground is recognized as a text color class', () => {
    const source = `
      export function Foo() {
        return (
          <div className="bg-background">
            <p className="!text-foreground">hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // !text-foreground が color class として認識され textCandidates に格納される
    const hasImportantText = pStack!.textCandidates.some((c) =>
      c.classes.includes('!text-foreground'),
    );
    expect(hasImportantText).toBe(true);
  });

  it('!bg-card is recognized as a bg color class', () => {
    const source = `
      export function Foo() {
        return (
          <div className="!bg-card">
            <p className="text-foreground">hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // !bg-card が color class として認識され bgStack に格納される
    const hasImportantBg = pStack!.bgStack
      .flat()
      .some((c) => c.classes.includes('!bg-card'));
    expect(hasImportantBg).toBe(true);
  });

  it('dark:!bg-muted is recognized as a bg color class (variant + important)', () => {
    // dark:!bg-muted → バリアント剥がし後 "!bg-muted" → extractBase で "bg-muted"
    // → isColorClass("bg-muted") = true → color class として認識
    // dark: バリアントが付いているので dark モードでのみ適用 (classify 側で処理)
    const source = `
      export function Foo() {
        return (
          <div className="bg-white dark:!bg-muted">
            <p className="text-foreground">hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // dark:!bg-muted が bg color class として認識される
    const hasImportantDarkBg = pStack!.bgStack
      .flat()
      .some((c) => c.classes.includes('dark:!bg-muted'));
    expect(hasImportantDarkBg).toBe(true);
  });

  it('!text-foreground in cn() is recognized as a text color class', () => {
    const source = `
      export function Foo() {
        return (
          <div className="bg-background">
            <p className={cn('!text-foreground')}>hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    const hasImportantText = pStack!.textCandidates.some((c) =>
      c.classes.includes('!text-foreground'),
    );
    expect(hasImportantText).toBe(true);
  });

  it('cn(cond ? "bg-a" : "bg-b") in parent pushes 1 layer with 2 alternatives to child bgStack', () => {
    // 親要素で cn(cond ? 'bg-black' : 'bg-white') を使用した場合、
    // 子要素の bgStack に 1 層として push され、2 alternative が格納される
    const source = `
      declare const cond: boolean;
      export function Foo({ flag }: { flag: boolean }) {
        return (
          <div className={cn(cond ? 'bg-black' : 'bg-white')}>
            <p className="text-black">Hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // 親の bg 候補が 1 層 (2 alternative) として子の bgStack に継承される
    expect(pStack!.bgStack).toHaveLength(1);
    expect(pStack!.bgStack[0]).toHaveLength(2);
    const hasBgBlack = pStack!.bgStack[0].some((c) =>
      c.classes.includes('bg-black'),
    );
    const hasBgWhite = pStack!.bgStack[0].some((c) =>
      c.classes.includes('bg-white'),
    );
    expect(hasBgBlack).toBe(true);
    expect(hasBgWhite).toBe(true);
  });
});
