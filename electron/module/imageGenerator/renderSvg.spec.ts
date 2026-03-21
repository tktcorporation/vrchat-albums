import { describe, expect, it } from 'vitest';
import { renderSvgToJpeg, renderSvgToPng } from './renderSvg';

describe('renderSvgToPng', () => {
  it('should render a simple SVG to PNG buffer', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <rect width="100" height="100" fill="red"/>
    </svg>`;
    const result = await renderSvgToPng(svg);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value[0]).toBe(0x89); // PNG magic byte
      expect(result.value[1]).toBe(0x50);
      expect(result.value[2]).toBe(0x4e);
      expect(result.value[3]).toBe(0x47);
    }
  });

  it('should render SVG with text using loaded fonts', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50">
      <text x="10" y="30" font-size="20" fill="black">Hello World</text>
    </svg>`;
    const result = await renderSvgToPng(svg);
    expect(result.isOk()).toBe(true);
  });

  it('should render SVG with Japanese text', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50">
      <text x="10" y="30" font-size="20" fill="black">テストワールド</text>
    </svg>`;
    const result = await renderSvgToPng(svg);
    expect(result.isOk()).toBe(true);
  });
});

describe('renderSvgToPng error handling', () => {
  it('should return SVG_RENDER_FAILED for invalid SVG', async () => {
    const result = await renderSvgToPng('not-valid-svg');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('SVG_RENDER_FAILED');
    }
  });

  it('should return SVG_RENDER_FAILED for empty string', async () => {
    const result = await renderSvgToPng('');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('SVG_RENDER_FAILED');
    }
  });
});

describe('renderSvgToJpeg', () => {
  it('should render SVG to JPEG buffer', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <rect width="100" height="100" fill="blue"/>
    </svg>`;
    const result = await renderSvgToJpeg(svg, 85);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value[0]).toBe(0xff); // JPEG magic byte
      expect(result.value[1]).toBe(0xd8);
    }
  });
});
