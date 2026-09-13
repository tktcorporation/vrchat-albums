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

  it('ダイアログが閉じている間はクエリを enabled にしない', () => {
    // enabled に isOpen が抜けていると、閉じた後も base64Data がキャッシュされた
    // ままになり、players の内容が変わるだけで誰も見ていないダイアログのために
    // worker が起動されてしまう
    render(
      <ShareDialog {...dialogProps} isOpen={false} players={makePlayers()} />,
    );

    const [, options] = generateSharePreviewUseQuery.mock.calls.at(-1) as [
      unknown,
      { enabled: boolean },
    ];
    expect(options.enabled).toBe(false);
  });

  it('ダイアログが開いていて画像の base64 と worldName が揃っている間はクエリを enabled にする', () => {
    render(<ShareDialog {...dialogProps} players={makePlayers()} />);

    const [, options] = generateSharePreviewUseQuery.mock.calls.at(-1) as [
      unknown,
      { enabled: boolean },
    ];
    expect(options.enabled).toBe(true);
  });
});
