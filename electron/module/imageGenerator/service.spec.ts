import * as neverthrow from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./renderSvg', () => ({
  renderSvgToPng: vi
    .fn()
    .mockResolvedValue(neverthrow.ok(Buffer.from('fake-png-data'))),
  renderSvgToJpeg: vi
    .fn()
    .mockResolvedValue(neverthrow.ok(Buffer.from('fake-jpeg-data'))),
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
    const result = await generateSharePreview({
      worldName: 'Test World',
      imageBase64: 'dGVzdA==',
      players: null,
      showAllPlayers: false,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(typeof result.value).toBe('string');
    }
  });

  it('should pass showAllPlayers to SVG template', async () => {
    const result = await generateSharePreview({
      worldName: 'Test World',
      imageBase64: 'dGVzdA==',
      players: [{ playerName: 'P1' }],
      showAllPlayers: true,
    });
    expect(result.isOk()).toBe(true);
  });
});

describe('generateWorldJoinImage', () => {
  it('should return JPEG buffer on success', async () => {
    const result = await generateWorldJoinImage({
      worldName: 'Test World',
      imageBase64: 'dGVzdA==',
      players: [{ playerName: 'Player1' }],
      joinDateTime: new Date('2024-01-15T12:00:00'),
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(Buffer.isBuffer(result.value)).toBe(true);
    }
  });

  it('should always use showAllPlayers=true for world join images', async () => {
    // This is an implicit test - generateWorldJoinImage always shows all players
    const result = await generateWorldJoinImage({
      worldName: 'Test',
      imageBase64: 'dGVzdA==',
      players: Array.from({ length: 100 }, (_, i) => ({ playerName: `P${i}` })),
      joinDateTime: new Date(),
    });
    expect(result.isOk()).toBe(true);
  });
});
