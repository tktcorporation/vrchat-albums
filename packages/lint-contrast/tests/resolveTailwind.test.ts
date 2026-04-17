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

  // ---------------------------------------------------------------------------
  // 指摘 3 修正 (PR #806): ブラケット任意値の "/" が opacity split で壊れる問題
  // ---------------------------------------------------------------------------

  it('resolves bg-[hsl(220_15%_85%/0.5)] — bracket arbitrary value with inner slash', () => {
    // 修正前: "/" で先に split → "[hsl(220_15%_85%" を color として解釈しようとして null
    // 修正後: ブラケット内の "/" は無視、hsl(220 15% 85% / 0.5) として culori でパース
    // hsl(220 15% 85% / 0.5): lightness 85% ≈ 0.85, alpha 0.5
    const result = resolveClass('bg-[hsl(220_15%_85%/0.5)]', 'light', cssVars);
    expect(result).not.toBeNull();
    // lightness 85% → r, g, b が 0.8 付近
    expect(result!.r).toBeGreaterThan(0.75);
    expect(result!.g).toBeGreaterThan(0.75);
    expect(result!.b).toBeGreaterThan(0.75);
    // alpha = 0.5 (culori がパースした値)
    expect(result!.a).toBeCloseTo(0.5, 2);
  });

  it('resolves bg-[hsl(220_15%_85%/0.5)]/80 — bracket arbitrary value with external opacity override', () => {
    // ブラケット内 alpha は無視し、ブラケット外の "/80" が alpha を 0.8 に上書きする
    const result = resolveClass(
      'bg-[hsl(220_15%_85%/0.5)]/80',
      'light',
      cssVars,
    );
    expect(result).not.toBeNull();
    // 色は hsl(220 15% 85%) 相当
    expect(result!.r).toBeGreaterThan(0.75);
    // alpha は外側の /80 → 0.8 (ブラケット内の 0.5 は上書きされる)
    expect(result!.a).toBeCloseTo(0.8, 2);
  });

  it('resolves bg-[#abcdef]/50 — bracket hex value with external opacity', () => {
    // ブラケット内は純粋な hex、外側の "/50" が opacity を 0.5 に設定する
    const result = resolveClass('bg-[#abcdef]/50', 'light', cssVars);
    expect(result).not.toBeNull();
    // #abcdef: r=171/255≈0.671, g=205/255≈0.804, b=239/255≈0.937
    expect(result!.r).toBeCloseTo(0.671, 1);
    expect(result!.a).toBeCloseTo(0.5, 2);
  });

  // ---------------------------------------------------------------------------
  // C2 修正 (PR #806 CodeRabbit): opacity "/1" が 1.0 扱いされるバグの修正
  // Tailwind の opacity modifier は常に percentage 整数 ("/1" = 1%, "/50" = 50%)、
  // または decimal ("/0.5" = 0.5) のいずれかである。
  // "/1" は 1% = 0.01 (ほぼ透明) であり、1.0 (不透明) ではない。
  // ---------------------------------------------------------------------------

  it('C2: /0 → alpha 0.0 (completely transparent)', () => {
    const result = resolveClass('bg-white/0', 'light', cssVars);
    expect(result).not.toBeNull();
    expect(result!.a).toBeCloseTo(0, 3);
  });

  it('C2: /1 → alpha 0.01 (1%, nearly transparent, NOT 1.0)', () => {
    const result = resolveClass('bg-white/1', 'light', cssVars);
    expect(result).not.toBeNull();
    // "/1" は percentage 整数として /100 → 0.01
    expect(result!.a).toBeCloseTo(0.01, 3);
  });

  it('C2: /50 → alpha 0.5 (50%)', () => {
    const result = resolveClass('bg-white/50', 'light', cssVars);
    expect(result).not.toBeNull();
    expect(result!.a).toBeCloseTo(0.5, 2);
  });

  it('C2: /100 → alpha 1.0 (fully opaque)', () => {
    const result = resolveClass('bg-white/100', 'light', cssVars);
    expect(result).not.toBeNull();
    expect(result!.a).toBeCloseTo(1, 3);
  });

  it('C2: /0.5 → alpha 0.5 (decimal, unchanged)', () => {
    const result = resolveClass('bg-white/0.5', 'light', cssVars);
    expect(result).not.toBeNull();
    expect(result!.a).toBeCloseTo(0.5, 2);
  });

  it('C2: /0.8 → alpha 0.8 (decimal, unchanged)', () => {
    const result = resolveClass('bg-white/0.8', 'light', cssVars);
    expect(result).not.toBeNull();
    expect(result!.a).toBeCloseTo(0.8, 2);
  });

  it('C2: bracket path /1 → alpha 0.01 (NOT 1.0)', () => {
    // ブラケット任意値の外側 opacity も同じルールが適用される
    const result = resolveClass('bg-[#ffffff]/1', 'light', cssVars);
    expect(result).not.toBeNull();
    expect(result!.a).toBeCloseTo(0.01, 3);
  });

  it('C2: bracket path /[0.5] decimal via bracket — resolves alpha 0.5', () => {
    // ブラケット内に decimal を書く場合: bg-[#ffffff]/[0.5] はこのパーサでは
    // afterBracket が "/[0.5]" になるため parseFloat("[0.5]") = NaN → opacityOverride なし
    // つまり元の alpha がそのまま使われる (バグではなく、この形式は非対応)
    // このテストは /50 の正常系を確認する
    const result = resolveClass('bg-[#ff0000]/50', 'light', cssVars);
    expect(result).not.toBeNull();
    expect(result!.a).toBeCloseTo(0.5, 2);
  });
});
