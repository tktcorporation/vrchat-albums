import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./renderSvg', () => ({
  renderSvgToPng: vi
    .fn()
    .mockReturnValue(Effect.succeed(Buffer.from('fake-png-data'))),
  renderSvgToJpeg: vi
    .fn()
    .mockReturnValue(Effect.succeed(Buffer.from('fake-jpeg-data'))),
}));

vi.mock('./colorExtractor', () => ({
  extractDominantColorsFromBuffer: vi.fn().mockResolvedValue({
    primary: 'rgb(100, 50, 200)',
    secondary: 'rgb(200, 210, 240)',
    accent: 'rgb(180, 170, 220)',
  }),
}));

import { runImageGenerationJob } from './jobRunner';
import { renderSvgToJpeg, renderSvgToPng } from './renderSvg';

describe('runImageGenerationJob (png)', () => {
  it('should return PNG buffer on success', async () => {
    const value = await Effect.runPromise(
      runImageGenerationJob({
        outputFormat: 'png',
        worldName: 'Test World',
        imageBase64: 'dGVzdA==',
        players: null,
        showAllPlayers: false,
        fontFilePaths: ['/fonts/Inter-Regular.ttf'],
      }),
    );
    expect(Buffer.isBuffer(value)).toBe(true);
  });

  it('should pass fontFilePaths through to renderSvgToPng without loading fonts itself', async () => {
    await Effect.runPromise(
      runImageGenerationJob({
        outputFormat: 'png',
        worldName: 'Test World',
        imageBase64: 'dGVzdA==',
        players: [{ playerName: 'P1' }],
        showAllPlayers: true,
        fontFilePaths: ['/fonts/Inter-Bold.ttf'],
      }),
    );
    expect(renderSvgToPng).toHaveBeenCalledWith(expect.any(String), [
      '/fonts/Inter-Bold.ttf',
    ]);
  });
});

describe('runImageGenerationJob (jpeg)', () => {
  it('should return JPEG buffer on success', async () => {
    const value = await Effect.runPromise(
      runImageGenerationJob({
        outputFormat: 'jpeg',
        worldName: 'Test World',
        imageBase64: 'dGVzdA==',
        players: [{ playerName: 'Player1' }],
        fontFilePaths: [],
        jpegQuality: 85,
      }),
    );
    expect(Buffer.isBuffer(value)).toBe(true);
  });

  it('should always render with showAllPlayers=true for jpeg (world join) jobs', async () => {
    await Effect.runPromise(
      runImageGenerationJob({
        outputFormat: 'jpeg',
        worldName: 'Test',
        imageBase64: 'dGVzdA==',
        players: Array.from({ length: 100 }, (_, i) => ({
          playerName: `P${i}`,
        })),
        fontFilePaths: [],
        jpegQuality: 85,
      }),
    );
    expect(renderSvgToJpeg).toHaveBeenCalledWith(
      expect.stringContaining('PLAYERS (100)'),
      [],
      85,
    );
  });
});
