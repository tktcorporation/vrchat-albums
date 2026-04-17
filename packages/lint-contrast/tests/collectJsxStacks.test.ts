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
});
