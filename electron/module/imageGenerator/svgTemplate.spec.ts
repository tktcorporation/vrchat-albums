import { describe, expect, it } from 'vitest';
import { generatePreviewSvg } from './svgTemplate';

describe('generatePreviewSvg', () => {
  const defaultColors = {
    primary: 'rgb(102, 51, 204)',
    secondary: 'rgb(218, 223, 245)',
    accent: 'rgb(204, 191, 230)',
  };

  it('should generate valid SVG with world name', () => {
    const result = generatePreviewSvg({
      worldName: 'Test World',
      imageBase64: 'dGVzdA==',
      players: null,
      showAllPlayers: false,
      colors: defaultColors,
    });
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('Test World');
    expect(result.svg).toContain('</svg>');
    expect(result.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('should include player elements when players provided', () => {
    const result = generatePreviewSvg({
      worldName: 'Test World',
      imageBase64: 'dGVzdA==',
      players: [{ playerName: 'Player1' }, { playerName: 'Player2' }],
      showAllPlayers: true,
      colors: defaultColors,
    });
    expect(result.svg).toContain('Player1');
    expect(result.svg).toContain('Player2');
    expect(result.svg).toContain('PLAYERS (2)');
  });

  it('should show +N more when showAllPlayers is false', () => {
    const manyPlayers = Array.from({ length: 50 }, (_, i) => ({
      playerName: `LongPlayerName${i}`,
    }));
    const result = generatePreviewSvg({
      worldName: 'Test World',
      imageBase64: 'dGVzdA==',
      players: manyPlayers,
      showAllPlayers: false,
      colors: defaultColors,
    });
    expect(result.svg).toContain('more');
  });

  it('should handle Japanese names', () => {
    const result = generatePreviewSvg({
      worldName: 'はじまりタウン',
      imageBase64: 'dGVzdA==',
      players: [{ playerName: 'ばーゆ' }],
      showAllPlayers: true,
      colors: defaultColors,
    });
    expect(result.svg).toContain('はじまりタウン');
    expect(result.svg).toContain('ばーゆ');
  });

  it('should return height >= 600', () => {
    const result = generatePreviewSvg({
      worldName: 'Test',
      imageBase64: 'dGVzdA==',
      players: null,
      showAllPlayers: false,
      colors: defaultColors,
    });
    expect(result.height).toBeGreaterThanOrEqual(600);
  });

  it('should handle null players', () => {
    const result = generatePreviewSvg({
      worldName: 'Test',
      imageBase64: 'dGVzdA==',
      players: null,
      showAllPlayers: false,
      colors: defaultColors,
    });
    expect(result.svg).not.toContain('PLAYERS');
  });

  it('should handle empty players array', () => {
    const result = generatePreviewSvg({
      worldName: 'Test',
      imageBase64: 'dGVzdA==',
      players: [],
      showAllPlayers: false,
      colors: defaultColors,
    });
    expect(result.svg).not.toContain('PLAYERS');
  });
});
