import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./renderSvg', () => ({
  loadFonts: vi.fn().mockReturnValue(Effect.succeed(['/fonts/Inter.ttf'])),
}));

vi.mock('./workerClient', () => ({
  runInWorker: vi.fn().mockReturnValue(Effect.succeed(Buffer.from('rendered'))),
}));

import { generateSharePreview, generateWorldJoinImage } from './service';
import { runInWorker } from './workerClient';

describe('generateSharePreview', () => {
  it('should resolve fonts on the Main process, then dispatch a PNG job to the worker', async () => {
    const value = await Effect.runPromise(
      generateSharePreview({
        worldName: 'Test World',
        imageBase64: 'dGVzdA==',
        players: [{ playerName: 'P1' }],
        showAllPlayers: true,
      }),
    );

    expect(value).toBe(Buffer.from('rendered').toString('base64'));
    expect(runInWorker).toHaveBeenCalledWith({
      outputFormat: 'png',
      worldName: 'Test World',
      imageBase64: 'dGVzdA==',
      players: [{ playerName: 'P1' }],
      showAllPlayers: true,
      fontFilePaths: ['/fonts/Inter.ttf'],
    });
  });
});

describe('generateWorldJoinImage', () => {
  it('should always dispatch a JPEG job with showAllPlayers implied (worker enforces it)', async () => {
    const value = await Effect.runPromise(
      generateWorldJoinImage({
        worldName: 'Test',
        imageBase64: 'dGVzdA==',
        players: [{ playerName: 'Player1' }],
        joinDateTime: new Date('2024-01-15T12:00:00'),
      }),
    );

    expect(Buffer.isBuffer(value)).toBe(true);
    expect(runInWorker).toHaveBeenCalledWith({
      outputFormat: 'jpeg',
      worldName: 'Test',
      imageBase64: 'dGVzdA==',
      players: [{ playerName: 'Player1' }],
      fontFilePaths: ['/fonts/Inter.ttf'],
      jpegQuality: 85,
    });
  });
});
