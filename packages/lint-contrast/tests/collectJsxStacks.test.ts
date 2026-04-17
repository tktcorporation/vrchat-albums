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
    expect(pStack!.bgStack.some((c) => c.classes.includes('bg-card'))).toBe(
      true,
    );
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
        s.bgStack.some((c) => c.classes.includes('bg-background')) &&
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
        s.bgStack.some((c) => c.classes.includes('bg-white/30')) &&
        s.elementName === 'p',
    );
    expect(innerStack).toBeDefined();
    expect(
      innerStack!.bgStack.some((c) => c.classes.includes('bg-background')),
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
    const hasBgBranch = pStack!.bgStack.some(
      (c) =>
        c.classes.includes('bg-card') || c.branchLabel?.includes('conditional'),
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
    const hasVariantPseudo = pStack!.bgStack.some(
      (c) => c.branchLabel === 'variant-pseudo',
    );
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

  it('single element with cn(bg-black/50, bg-white/50) produces one bgStack entry', () => {
    // 同一要素内の複数 bg クラスは単一 ClassCandidate に連結される。
    // CSS cascade 的には bg-white/50 が後勝ち (同一要素なので compositeOver しない)。
    // 修正前: 2 候補 → bgStack に 2 エントリ → 親子合成として誤って compositeOver される可能性
    // 修正後: 1 候補 { classes: ['bg-black/50', 'bg-white/50'] } → classify 側の最後勝ちロジック
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
    // 子要素 p の bgStack に div の bg が継承される
    // div の bgCandidates は 1 候補のはず (2 候補に分かれていてはいけない)
    // bgStack[0] が単一 ClassCandidate { classes: ['bg-black/50', 'bg-white/50'] }
    expect(pStack!.bgStack).toHaveLength(1);
    expect(pStack!.bgStack[0].classes).toContain('bg-black/50');
    expect(pStack!.bgStack[0].classes).toContain('bg-white/50');
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
    const hasVariantPseudo = pStack!.bgStack.some(
      (c) => c.branchLabel === 'variant-pseudo',
    );
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
