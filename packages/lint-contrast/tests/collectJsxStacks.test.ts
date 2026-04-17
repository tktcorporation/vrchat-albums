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
