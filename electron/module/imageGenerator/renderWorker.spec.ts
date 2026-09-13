import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { ImageConversionFailed, SvgRenderFailed } from './errors';

vi.mock('./jobRunner', () => ({
  runImageGenerationJob: vi.fn(),
}));

import { runImageGenerationJob } from './jobRunner';
import { handleMessage } from './renderWorker';

const job = {
  outputFormat: 'png' as const,
  worldName: 'Test World',
  imageBase64: 'dGVzdA==',
  players: null,
  showAllPlayers: false,
  fontFilePaths: [],
};

describe('handleMessage', () => {
  it('should post a success response with base64-encoded buffer', async () => {
    vi.mocked(runImageGenerationJob).mockReturnValue(
      Effect.succeed(Buffer.from('hello')),
    );
    const postMessage = vi.fn();

    await handleMessage(job, postMessage);

    expect(postMessage).toHaveBeenCalledWith({
      ok: true,
      base64: Buffer.from('hello').toString('base64'),
    });
  });

  it('should convert a SvgRenderFailed instance into a plain {_tag, message} object before posting', async () => {
    // Data.TaggedError は Error のサブクラスであり、worker_threads の
    // postMessage(構造化クローン)を経由すると _tag 等の独自プロパティが失われる。
    // handleMessage がインスタンスをそのまま渡さず、明示的にプレーンオブジェクト化
    // していることをここで固定する(この変換を怠ると全エラーが再分類不能になる)。
    vi.mocked(runImageGenerationJob).mockReturnValue(
      Effect.fail(new SvgRenderFailed({ message: 'render boom' })),
    );
    const postMessage = vi.fn();

    await handleMessage(job, postMessage);

    const [response] = postMessage.mock.calls[0] as [unknown];
    expect(response).toEqual({
      ok: false,
      error: { _tag: 'SvgRenderFailed', message: 'render boom' },
    });
    // TaggedError インスタンスそのものではなく、プロトタイプを持たない
    // プレーンオブジェクトであることを確認する
    expect(
      (response as { error: unknown }).error instanceof SvgRenderFailed,
    ).toBe(false);
  });

  it('should convert an ImageConversionFailed instance into a plain object before posting', async () => {
    vi.mocked(runImageGenerationJob).mockReturnValue(
      Effect.fail(new ImageConversionFailed({ message: 'jpeg boom' })),
    );
    const postMessage = vi.fn();

    await handleMessage(job, postMessage);

    expect(postMessage).toHaveBeenCalledWith({
      ok: false,
      error: { _tag: 'ImageConversionFailed', message: 'jpeg boom' },
    });
  });

  it('should throw (not postMessage) on an unexpected defect, letting it surface as a worker error event', async () => {
    vi.mocked(runImageGenerationJob).mockReturnValue(
      Effect.die(new Error('unexpected programming error')),
    );
    const postMessage = vi.fn();

    await expect(handleMessage(job, postMessage)).rejects.toThrow(
      'unexpected programming error',
    );
    expect(postMessage).not.toHaveBeenCalled();
  });
});
