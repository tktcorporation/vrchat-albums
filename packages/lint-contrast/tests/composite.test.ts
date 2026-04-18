/**
 * compositeOver の単体テスト。
 *
 * Porter-Duff "over" アルファ合成ロジックを検証する。
 */

import { describe, expect, it } from 'vitest';

import { compositeOver } from '../src/composite.js';
import type { Rgba } from '../src/types.js';

describe('compositeOver', () => {
  it('returns base when stack is empty', () => {
    const base: Rgba = { r: 1, g: 1, b: 1, a: 1 };
    const result = compositeOver([], base);
    expect(result).toEqual(base);
  });

  it('returns opaque layer unchanged over any base', () => {
    const base: Rgba = { r: 0, g: 0, b: 0, a: 1 };
    const layer: Rgba = { r: 1, g: 0, b: 0, a: 1 }; // opaque red
    const result = compositeOver([layer], base);
    expect(result.r).toBeCloseTo(1, 5);
    expect(result.g).toBeCloseTo(0, 5);
    expect(result.b).toBeCloseTo(0, 5);
    expect(result.a).toBeCloseTo(1, 5);
  });

  it('composites semi-transparent white over black correctly', () => {
    // white/30 over black → 30% toward white from black
    const base: Rgba = { r: 0, g: 0, b: 0, a: 1 };
    const layer: Rgba = { r: 1, g: 1, b: 1, a: 0.3 };
    const result = compositeOver([layer], base);
    // ao = 0.3 + 1.0 * 0.7 = 1.0
    // r = (1*0.3 + 0*1*0.7) / 1.0 = 0.3
    expect(result.r).toBeCloseTo(0.3, 5);
    expect(result.g).toBeCloseTo(0.3, 5);
    expect(result.b).toBeCloseTo(0.3, 5);
    expect(result.a).toBeCloseTo(1, 5);
  });

  it('composites multiple layers from outermost to innermost', () => {
    const base: Rgba = { r: 1, g: 1, b: 1, a: 1 }; // white
    const outerBlue: Rgba = { r: 0, g: 0, b: 1, a: 0.5 };
    const innerRed: Rgba = { r: 1, g: 0, b: 0, a: 0.5 };

    const result = compositeOver([outerBlue, innerRed], base);
    expect(result.r).toBeCloseTo(0.75, 4);
    expect(result.g).toBeCloseTo(0.25, 4);
    expect(result.b).toBeCloseTo(0.5, 4);
    expect(result.a).toBeCloseTo(1, 4);
  });

  it('handles both layers fully transparent', () => {
    const base: Rgba = { r: 0, g: 0, b: 0, a: 0 };
    const layer: Rgba = { r: 1, g: 1, b: 1, a: 0 };
    const result = compositeOver([layer], base);
    expect(result.a).toBeCloseTo(0, 5);
  });
});
