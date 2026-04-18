/**
 * evaluateContrast の単体テスト。
 *
 * WCAG 2.1 コントラスト比計算を検証する。
 */

import { describe, expect, it } from 'vitest';

import {
  wcagContrastRatio,
  relativeLuminance,
  WCAG_AA_THRESHOLD,
} from '../src/evaluateContrast.js';
import type { Rgba } from '../src/types.js';

describe('evaluateContrast', () => {
  it('returns 21:1 for black on white', () => {
    const black: Rgba = { r: 0, g: 0, b: 0, a: 1 };
    const white: Rgba = { r: 1, g: 1, b: 1, a: 1 };
    const ratio = wcagContrastRatio(black, white);
    expect(ratio).toBeCloseTo(21, 0);
  });

  it('returns 1:1 for same color', () => {
    const gray: Rgba = { r: 0.5, g: 0.5, b: 0.5, a: 1 };
    const ratio = wcagContrastRatio(gray, gray);
    expect(ratio).toBeCloseTo(1, 5);
  });

  it('bg-background/text-foreground (light) passes AA', () => {
    // Light: background = white, foreground = hsl(0 0% 9%)
    const bg: Rgba = { r: 1, g: 1, b: 1, a: 1 };
    const fg: Rgba = { r: 0.09, g: 0.09, b: 0.09, a: 1 };
    const ratio = wcagContrastRatio(fg, bg);
    expect(ratio).toBeGreaterThan(WCAG_AA_THRESHOLD);
    expect(ratio).toBeGreaterThan(15);
  });

  it('bg-background/text-foreground (dark) passes AA', () => {
    // Dark: background ≈ hsl(220 27% 8%), foreground ≈ hsl(220 15% 85%)
    const bg: Rgba = { r: 0.0584, g: 0.0728, b: 0.1016, a: 1 };
    const fg: Rgba = { r: 0.8275, g: 0.8425, b: 0.8725, a: 1 };
    const ratio = wcagContrastRatio(fg, bg);
    expect(ratio).toBeGreaterThan(WCAG_AA_THRESHOLD);
    expect(ratio).toBeGreaterThan(10);
  });

  it('detects low contrast (dark 15% bg / 40% fg)', () => {
    const bg: Rgba = { r: 0.15, g: 0.15, b: 0.15, a: 1 };
    const fg: Rgba = { r: 0.4, g: 0.4, b: 0.4, a: 1 };
    const ratio = wcagContrastRatio(fg, bg);
    expect(ratio).toBeLessThan(WCAG_AA_THRESHOLD);
    expect(ratio).toBeLessThan(3);
  });

  it('WCAG_AA_THRESHOLD is 4.5', () => {
    expect(WCAG_AA_THRESHOLD).toBe(4.5);
  });

  it('relativeLuminance of white is 1.0', () => {
    const white: Rgba = { r: 1, g: 1, b: 1, a: 1 };
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
  });

  it('relativeLuminance of black is 0.0', () => {
    const black: Rgba = { r: 0, g: 0, b: 0, a: 1 };
    expect(relativeLuminance(black)).toBeCloseTo(0, 5);
  });
});
