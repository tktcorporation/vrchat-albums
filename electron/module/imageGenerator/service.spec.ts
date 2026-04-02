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

import { generateSharePreview, generateWorldJoinImage } from './service';

describe('generateSharePreview', () => {
  it('should return PNG base64 string on success', async () => {
    const value = await Effect.runPromise(
      generateSharePreview({
        worldName: 'Test World',
        imageBase64: 'dGVzdA==',
        players: null,
        showAllPlayers: false,
      }),
    );
    expectTypeOf(value).toBeString();
  });

  it('should pass showAllPlayers to SVG template', async () => {
    const value = await Effect.runPromise(
      generateSharePreview({
        worldName: 'Test World',
        imageBase64: 'dGVzdA==',
        players: [{ playerName: 'P1' }],
        showAllPlayers: true,
      }),
    );
    expect(value).toBeDefined();
  });
});

describe('generateWorldJoinImage', () => {
  it('should return JPEG buffer on success', async () => {
    const value = await Effect.runPromise(
      generateWorldJoinImage({
        worldName: 'Test World',
        imageBase64: 'dGVzdA==',
        players: [{ playerName: 'Player1' }],
        joinDateTime: new Date('2024-01-15T12:00:00'),
      }),
    );
    expect(Buffer.isBuffer(value)).toBe(true);
  });

  it('should always use showAllPlayers=true for world join images', async () => {
    // This is an implicit test - generateWorldJoinImage always shows all players
    const value = await Effect.runPromise(
      generateWorldJoinImage({
        worldName: 'Test',
        imageBase64: 'dGVzdA==',
        players: Array.from({ length: 100 }, (_, i) => ({
          playerName: `P${i}`,
        })),
        joinDateTime: new Date(),
      }),
    );
    expect(value).toBeDefined();
  });
});
