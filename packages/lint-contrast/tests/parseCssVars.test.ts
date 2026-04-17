/**
 * parseCssVars の単体テスト。
 *
 * :root (light) と .dark セレクタからの CSS 変数抽出と
 * HSL → RGBA 変換を検証する。
 */

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { parseCssVars } from '../src/parseCssVars.js';

const MOCK_CSS = path.resolve(
  import.meta.dirname,
  '../test-fixtures/mock-index.css',
);

// C15 修正 (PR #806 CodeRabbit): createTempCss で作成した temp dir を afterAll でクリーンアップ
const tempDirs: string[] = [];

function createTempCss(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lint-contrast-'));
  tempDirs.push(dir);
  const cssPath = path.join(dir, 'index.css');
  writeFileSync(cssPath, content, 'utf8');
  return cssPath;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

  it('parses minimal CSS with only :root; dark inherits all :root vars', () => {
    // .dark セレクタがない場合、dark マップは :root (light) の全変数を継承する。
    // CSS カスタムプロパティの継承挙動: .dark セレクタが存在しなくても :root 変数は参照可能。
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
    // dark マップは light を継承するので、:root 変数が含まれる
    expect(vars.dark['--background']).toBeDefined();
    expect(vars.dark['--background'].r).toBeCloseTo(1, 2);
    expect(vars.dark['--foreground']).toBeDefined();
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

  it('dark map inherits :root variables not redefined in .dark', () => {
    // CSS カスタムプロパティは継承される。.dark で再定義されていない変数は :root の値を使う。
    // 修正前: dark マップは .dark 内宣言のみ → :root 変数が未定義扱いになっていた
    // 修正後: dark マップは { ...light } で初期化 → :root 変数も参照可能
    const css = `
      @layer base {
        :root {
          --foo: 0 0% 50%;
          --bar: 0 0% 90%;
        }
        .dark {
          --bar: 0 0% 10%;
        }
      }
    `;
    const cssPath = createTempCss(css);
    const vars = parseCssVars(cssPath);

    // --foo は .dark で未定義 → :root (light) から継承されるべき
    expect(vars.dark['--foo']).toBeDefined();
    expect(vars.dark['--foo'].r).toBeCloseTo(0.5, 2); // 50% L in HSL ≈ gray

    // --bar は .dark で上書き → dark の値が使われるべき
    expect(vars.dark['--bar']).toBeDefined();
    expect(vars.dark['--bar'].r).toBeLessThan(0.2); // 10% L in HSL ≈ very dark
  });

  it('.dark definition overrides :root definition for the same variable', () => {
    // .dark で --foo を再定義した場合、dark マップでは dark の値で上書きされる
    const css = `
      :root {
        --foo: 0 0% 50%;
      }
      .dark {
        --foo: 0 0% 90%;
      }
    `;
    const cssPath = createTempCss(css);
    const vars = parseCssVars(cssPath);

    // light: :root の値 (50%L ≈ gray)
    expect(vars.light['--foo'].r).toBeCloseTo(0.5, 2);
    // dark: .dark の値 (90%L ≈ near white)
    expect(vars.dark['--foo'].r).toBeGreaterThan(0.85);
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

  // C5 修正 (PR #806 CodeRabbit): @media / @supports 内のルールを light/dark マップに混入させない。
  // darkMode: 'media' パターン (@media prefers-color-scheme: dark { :root { ... } }) が
  // light マップに誤って混入するのを防ぐ。
  it('C5: @media { :root { --x } } does not pollute light map', () => {
    // darkMode: 'media' スタイルの CSS: @media prefers-color-scheme: dark 内の :root
    // これは light テーマ変数として扱うべきではない
    const css = `
      :root {
        --background: 0 0% 100%;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --background: 220 27% 8%;
        }
      }
    `;
    const cssPath = createTempCss(css);
    const vars = parseCssVars(cssPath);

    // @media 内の :root は skip されるため、light の --background は :root の値のまま
    expect(vars.light['--background']).toBeDefined();
    expect(vars.light['--background'].r).toBeCloseTo(1, 2); // white (0 0% 100%)

    // @media 内なので dark マップにも混入しない (dark は light を継承するだけ)
    // 220 27% 8% の dark 値が dark['--background'] に入っていないこと
    // (もし入っていれば r < 0.1 になるはず)
    expect(vars.dark['--background'].r).toBeCloseTo(1, 2); // still white
  });

  it('C5: @supports { :root { --x } } does not pollute light map', () => {
    const css = `
      :root {
        --background: 0 0% 100%;
      }
      @supports (color: hsl(0 0% 0%)) {
        :root {
          --background: 220 27% 8%;
        }
      }
    `;
    const cssPath = createTempCss(css);
    const vars = parseCssVars(cssPath);

    // @supports 内は skip されるため、light の --background は :root の値のまま
    expect(vars.light['--background'].r).toBeCloseTo(1, 2);
  });

  it('C5: @layer base { :root { ... } } still processes correctly (structural at-rule)', () => {
    // @layer は条件分岐ではなく構造的 at-rule なので通す
    const css = `
      @layer base {
        :root {
          --background: 0 0% 100%;
        }
        .dark {
          --background: 220 27% 8%;
        }
      }
    `;
    const cssPath = createTempCss(css);
    const vars = parseCssVars(cssPath);

    expect(vars.light['--background'].r).toBeCloseTo(1, 2); // white
    expect(vars.dark['--background'].r).toBeLessThan(0.1); // dark (8% L)
  });

  // ---------------------------------------------------------------------------
  // G3 修正 (PR #806 Codex): @media / @supports の祖先 at-rule を全て検査する。
  // 修正前: rule.parent のみチェック → @media { @layer { :root { ... } } } が通過していた。
  // 修正後: hasConditionalAncestor で全祖先を辿り、@media / @supports があれば skip。
  // ---------------------------------------------------------------------------

  it('G3: @media { :root { --x } } does not pollute light map (direct parent check)', () => {
    // 既存 C5 テストと同等だが G3 文脈で明示
    const css = `
      :root {
        --background: 0 0% 100%;
      }
      @media (max-width: 768px) {
        :root {
          --background: 220 27% 8%;
        }
      }
    `;
    const cssPath = createTempCss(css);
    const vars = parseCssVars(cssPath);
    // @media 内の :root は skip → light は無条件の :root の値 (white) を保持する
    expect(vars.light['--background'].r).toBeCloseTo(1, 2);
    // dark も混入しない (light を継承するだけ)
    expect(vars.dark['--background'].r).toBeCloseTo(1, 2);
  });

  it('G3: @media { @layer base { :root { --x } } } — nested media+layer is skipped', () => {
    // G3 の核心: rule.parent が @layer (構造的) でも、祖先に @media があれば skip すべき。
    // 修正前: parent が @layer なので pass → 条件付きトークンが混入していた。
    // 修正後: hasConditionalAncestor が @media 祖先を検出して skip。
    const css = `
      :root {
        --background: 0 0% 100%;
      }
      @media (prefers-color-scheme: dark) {
        @layer base {
          :root {
            --background: 220 27% 8%;
          }
        }
      }
    `;
    const cssPath = createTempCss(css);
    const vars = parseCssVars(cssPath);
    // @media 内 @layer 内の :root は skip → light は white を保持
    expect(vars.light['--background'].r).toBeCloseTo(1, 2);
    // dark も white (条件付きトークンは混入しない)
    expect(vars.dark['--background'].r).toBeCloseTo(1, 2);
  });

  it('G3: @layer base { :root { ... } } (no @media ancestor) — still processed correctly', () => {
    // @layer のみの入れ子 (親祖先に @media / @supports なし) は引き続き処理される
    const css = `
      @layer base {
        :root {
          --x: 0 0% 50%;
        }
      }
    `;
    const cssPath = createTempCss(css);
    const vars = parseCssVars(cssPath);
    // @layer は構造的 at-rule → 処理される
    expect(vars.light['--x']).toBeDefined();
    expect(vars.light['--x'].r).toBeCloseTo(0.5, 2);
  });

  it('G3: @supports { :root { --x } } does not pollute light map', () => {
    // @supports 内も skip する (G3 の修正対象)
    const css = `
      :root {
        --background: 0 0% 100%;
      }
      @supports (color: hsl(0 0% 0%)) {
        @layer base {
          :root {
            --background: 220 27% 8%;
          }
        }
      }
    `;
    const cssPath = createTempCss(css);
    const vars = parseCssVars(cssPath);
    // @supports 内 @layer 内の :root は skip → white を保持
    expect(vars.light['--background'].r).toBeCloseTo(1, 2);
  });
});
