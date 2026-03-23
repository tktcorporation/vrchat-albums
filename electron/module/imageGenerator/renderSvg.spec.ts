import { Cause, Effect, Exit, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { renderSvgToJpeg, renderSvgToPng } from './renderSvg';

describe('renderSvgToPng', () => {
  it('should render a simple SVG to PNG buffer', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <rect width="100" height="100" fill="red"/>
    </svg>`;
    const value = await Effect.runPromise(renderSvgToPng(svg));
    expect(value[0]).toBe(0x89); // PNG magic byte
    expect(value[1]).toBe(0x50);
    expect(value[2]).toBe(0x4e);
    expect(value[3]).toBe(0x47);
  });

  it('should render SVG with text using loaded fonts', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50">
      <text x="10" y="30" font-size="20" fill="black">Hello World</text>
    </svg>`;
    const value = await Effect.runPromise(renderSvgToPng(svg));
    expect(value).toBeDefined();
  });

  it('should render SVG with Japanese text', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50">
      <text x="10" y="30" font-size="20" fill="black">テストワールド</text>
    </svg>`;
    const value = await Effect.runPromise(renderSvgToPng(svg));
    expect(value).toBeDefined();
  });
});

describe('renderSvgToPng error handling', () => {
  it('should return SvgRenderFailed for invalid SVG', async () => {
    const exit = await Effect.runPromiseExit(renderSvgToPng('not-valid-svg'));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failOpt = Cause.failureOption(exit.cause);
      expect(Option.isSome(failOpt)).toBe(true);
      if (Option.isSome(failOpt)) {
        expect(failOpt.value._tag).toBe('SvgRenderFailed');
      }
    }
  });

  it('should return SvgRenderFailed for empty string', async () => {
    const exit = await Effect.runPromiseExit(renderSvgToPng(''));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failOpt = Cause.failureOption(exit.cause);
      expect(Option.isSome(failOpt)).toBe(true);
      if (Option.isSome(failOpt)) {
        expect(failOpt.value._tag).toBe('SvgRenderFailed');
      }
    }
  });
});

describe('renderSvgToJpeg', () => {
  it('should render SVG to JPEG buffer', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <rect width="100" height="100" fill="blue"/>
    </svg>`;
    const value = await Effect.runPromise(renderSvgToJpeg(svg, 85));
    expect(value[0]).toBe(0xff); // JPEG magic byte
    expect(value[1]).toBe(0xd8);
  });
});
