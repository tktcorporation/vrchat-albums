/**
 * resolveTailwind の単体テスト。
 *
 * Tailwind クラス名 → RGBA 解決のロジックを検証する。
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseCssVars } from '../src/parseCssVars.js';
import { resolveClass } from '../src/resolveTailwind.js';

const MOCK_CSS = path.resolve(
  import.meta.dirname,
  '../test-fixtures/mock-index.css',
);

describe('resolveTailwind.resolveClass', () => {
  const cssVars = parseCssVars(MOCK_CSS);

  it('resolves bg-background to white in light mode', () => {
    const result = resolveClass('bg-background', 'light', cssVars);
    expect(result).not.toBeNull();
    expect(result!.r).toBeCloseTo(1, 2);
    expect(result!.g).toBeCloseTo(1, 2);
    expect(result!.b).toBeCloseTo(1, 2);
  });

  it('resolves text-foreground in dark mode', () => {
    const result = resolveClass('text-foreground', 'dark', cssVars);
    expect(result).not.toBeNull();
    expect(result!.r).toBeCloseTo(0.8275, 2);
  });

  it('resolves bg-card in light mode (semantic token)', () => {
    const result = resolveClass('bg-card', 'light', cssVars);
    expect(result).not.toBeNull();
    expect(result!.r).toBeCloseTo(1, 2);
  });

  it('resolves bg-card in dark mode (semantic token with alpha)', () => {
    const result = resolveClass('bg-card', 'dark', cssVars);
    expect(result).not.toBeNull();
    expect(result!.a).toBeCloseTo(0.7, 2);
  });

  it('resolves opacity modifier: bg-white/30', () => {
    const result = resolveClass('bg-white/30', 'light', cssVars);
    expect(result).not.toBeNull();
    expect(result!.r).toBeCloseTo(1, 2);
    expect(result!.a).toBeCloseTo(0.3, 2);
  });

  it('resolves opacity modifier: bg-white/80', () => {
    const result = resolveClass('bg-white/80', 'light', cssVars);
    expect(result).not.toBeNull();
    expect(result!.a).toBeCloseTo(0.8, 2);
  });

  it('returns null for non-color class (e.g., flex)', () => {
    const result = resolveClass('flex', 'light', cssVars);
    expect(result).toBeNull();
  });

  it('returns null for dark: prefix in light mode', () => {
    const result = resolveClass('dark:bg-card', 'light', cssVars);
    expect(result).toBeNull();
  });

  it('resolves dark: prefix in dark mode', () => {
    const result = resolveClass('dark:bg-card', 'dark', cssVars);
    expect(result).not.toBeNull();
  });

  it('resolves arbitrary hex value: bg-[#ff0000]', () => {
    const result = resolveClass('bg-[#ff0000]', 'light', cssVars);
    expect(result).not.toBeNull();
    expect(result!.r).toBeCloseTo(1, 2);
    expect(result!.g).toBeCloseTo(0, 2);
    expect(result!.b).toBeCloseTo(0, 2);
  });

  it('resolves text-muted-foreground in light mode', () => {
    const result = resolveClass('text-muted-foreground', 'light', cssVars);
    expect(result).not.toBeNull();
    // Light muted-foreground: hsl(0 0% 45%) ≈ gray
    expect(result!.r).toBeCloseTo(0.45, 2);
    expect(result!.g).toBeCloseTo(0.45, 2);
    expect(result!.b).toBeCloseTo(0.45, 2);
  });
});
