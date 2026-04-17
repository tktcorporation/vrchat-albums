/**
 * parseCssVars の単体テスト。
 *
 * :root (light) と .dark セレクタからの CSS 変数抽出と
 * HSL → RGBA 変換を検証する。
 */

import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseCssVars } from '../src/parseCssVars.js';

const MOCK_CSS = path.resolve(
  import.meta.dirname,
  '../test-fixtures/mock-index.css',
);

function createTempCss(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lint-contrast-'));
  const cssPath = path.join(dir, 'index.css');
  writeFileSync(cssPath, content, 'utf8');
  return cssPath;
}

describe('parseCssVars', () => {
  it('parses :root and .dark CSS variables from mock-index.css', () => {
    const vars = parseCssVars(MOCK_CSS);

    // Light --background = white
    expect(vars.light['--background']).toBeDefined();
    const bg = vars.light['--background'];
    expect(bg.r).toBeCloseTo(1, 2);
    expect(bg.g).toBeCloseTo(1, 2);
    expect(bg.b).toBeCloseTo(1, 2);
    expect(bg.a).toBeCloseTo(1, 2);

    // Dark --foreground = hsl(220 15% 85%)
    expect(vars.dark['--foreground']).toBeDefined();
    const fg = vars.dark['--foreground'];
    expect(fg.r).toBeCloseTo(0.8275, 2);
    expect(fg.g).toBeCloseTo(0.8425, 2);
    expect(fg.b).toBeCloseTo(0.8725, 2);
    expect(fg.a).toBeCloseTo(1, 2);
  });

  it('correctly parses HSL with alpha (dark --card: 220 27% 12% / 0.7)', () => {
    const vars = parseCssVars(MOCK_CSS);
    const card = vars.dark['--card'];
    expect(card).toBeDefined();
    expect(card.a).toBeCloseTo(0.7, 2);
  });

  it('parses minimal CSS with only :root', () => {
    const css = `
      @layer base {
        :root {
          --background: 0 0% 100%;
          --foreground: 0 0% 9%;
        }
      }
    `;
    const cssPath = createTempCss(css);
    const vars = parseCssVars(cssPath);

    expect(vars.light['--background'].r).toBeCloseTo(1, 2);
    expect(vars.light['--foreground'].r).toBeCloseTo(0.09, 2);
    expect(Object.keys(vars.dark)).toHaveLength(0);
  });

  it('handles :root and .dark in @layer base', () => {
    const css = `
      @layer base {
        :root {
          --card: 0 0% 100%;
        }
        .dark {
          --card: 220 27% 12% / 0.7;
        }
      }
    `;
    const cssPath = createTempCss(css);
    const vars = parseCssVars(cssPath);

    expect(vars.light['--card'].r).toBeCloseTo(1, 2);
    expect(vars.dark['--card'].a).toBeCloseTo(0.7, 2);
  });

  it('skips non-HSL CSS properties', () => {
    const css = `
      :root {
        --background: 0 0% 100%;
        --shadow: 0 1px 3px rgba(0,0,0,0.1);
        --spacing: 16px;
      }
    `;
    const cssPath = createTempCss(css);
    const vars = parseCssVars(cssPath);
    // Only --background should be present (shadow and spacing are not HSL)
    expect(vars.light['--background']).toBeDefined();
    expect(vars.light['--shadow']).toBeUndefined();
    expect(vars.light['--spacing']).toBeUndefined();
  });
});
