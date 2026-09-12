import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { generateSharePreviewUseQuery } = vi.hoisted(() => ({
  generateSharePreviewUseQuery: vi.fn().mockReturnValue({
    data: 'fake-preview-base64',
    isFetching: false,
    error: null,
  }),
}));

vi.mock('@/trpc', () => ({
  trpcReact: {
    vrchatApi: {
      convertImageToBase64: {
        useQuery: vi
          .fn()
          .mockReturnValue({ data: 'fake-image-base64', isLoading: false }),
      },
    },
    imageGenerator: {
      generateSharePreview: {
        useQuery: generateSharePreviewUseQuery,
      },
    },
    electronUtil: {
      copyImageDataByBase64: {
        useMutation: vi.fn().mockReturnValue({ mutateAsync: vi.fn() }),
      },
      downloadImageAsPhotoLogPng: {
        useMutation: vi.fn().mockReturnValue({ mutateAsync: vi.fn() }),
      },
    },
  },
}));

import { ShareDialog } from './ShareDialog';

const makePlayers = () => [
  {
    id: '1',
    playerId: 'usr_1',
    playerName: 'Alice',
    joinDateTime: new Date('2024-01-01T00:00:00Z'),
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  },
];

const dialogProps = {
  isOpen: true,
  onClose: () => {},
  worldName: 'Test World',
  worldId: 'wrld_123',
  joinDateTime: new Date('2024-01-01T00:00:00Z'),
  imageUrl: 'https://example.com/image.png',
};

describe('ShareDialog', () => {
  it('generateSharePreview を useQuery として呼び出す(useMutation+useEffectパターンへの回帰防止)', () => {
    render(<ShareDialog {...dialogProps} players={makePlayers()} />);

    expect(generateSharePreviewUseQuery).toHaveBeenCalled();
  });

  it('players が毎レンダー新しい配列参照でも、クエリ入力は内容が同じなら構造的に同一になる', () => {
    const { rerender } = render(
      <ShareDialog {...dialogProps} players={makePlayers()} />,
    );
    const firstInput = generateSharePreviewUseQuery.mock.calls.at(-1)?.[0];

    // LocationGroupHeader は players を毎レンダー新しい配列として生成しうる
    // (内容が同じでも参照は変わる)。フリーズの原因だったのは、この不安定な参照が
    // useEffect の依存配列に漏れ込み無限ループを起こしたことだった。
    // ここではクエリ入力そのものが内容ベースで安定していることを確認する。
    rerender(<ShareDialog {...dialogProps} players={makePlayers()} />);
    const secondInput = generateSharePreviewUseQuery.mock.calls.at(-1)?.[0];

    expect(secondInput).toStrictEqual(firstInput);
  });
});
