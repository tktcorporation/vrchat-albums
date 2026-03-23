import { render } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BoldPreviewSvg } from './BoldPreview';

// jsdomではレイアウト計算が正確に行われないため、getBoundingClientRectをモック化
// beforeAll内で置き換え前に参照をキャプチャすることで、置き換え後の無限再帰を防ぐ
let originalGetBoundingClientRect: typeof Element.prototype.getBoundingClientRect;
beforeAll(() => {
  // oxlint-disable-next-line typescript-eslint(unbound-method) -- 置き換え前の参照キャプチャが目的。.call(this)で正しくバインドして使用する
  originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    if (this.textContent?.includes('Player')) {
      // プレイヤー名の要素には固定の幅を返す
      // 1行あたり6プレイヤーまで表示できるように設定
      return { width: 100, height: 30 } as DOMRect;
    }
    return originalGetBoundingClientRect.call(this);
  };
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

describe('BoldPreviewSvg', () => {
  /**
   * 指定数分のモックプレイヤー配列を生成するヘルパー。
   * 各テストケースでプレイヤーリストを用意する際に利用する。
   */
  const generatePlayers = (count: number) => {
    return Array.from({ length: count }, (_, i) => ({
      id: `id-${i}`,
      playerId: `player-${i}`,
      playerName: `Player ${i}`,
      joinDateTime: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  };

  it('すべてのプレイヤーが表示されること（showAllPlayers=true）', () => {
    const players = generatePlayers(20);
    const { container } = render(
      <BoldPreviewSvg
        worldName="Test World"
        players={players}
        showAllPlayers={true}
      />,
    );

    // すべてのプレイヤー名が表示されていることを確認
    for (const player of players) {
      expect(container.textContent).toContain(player.playerName);
    }

    // "+N人" の要素が存在しないことを確認
    expect(container.textContent).not.toMatch(/\+\d+人/);
  });

  it('プレイヤー数が多い場合でも正しく表示されること（showAllPlayers=true）', () => {
    const players = generatePlayers(50);
    const { container } = render(
      <BoldPreviewSvg
        worldName="Test World"
        players={players}
        showAllPlayers={true}
      />,
    );

    // すべてのプレイヤー名が表示されていることを確認
    for (const player of players) {
      expect(container.textContent).toContain(player.playerName);
    }

    // "+N人" の要素が存在しないことを確認
    expect(container.textContent).not.toMatch(/\+\d+人/);
  });

  it('showAllPlayers=falseの場合、一部のプレイヤーのみ表示されること', () => {
    const players = generatePlayers(20);
    const { container } = render(
      <BoldPreviewSvg
        worldName="Test World"
        players={players}
        showAllPlayers={false}
      />,
    );

    // 最初の数人のプレイヤーが表示されていることを確認
    expect(container.textContent).toContain('Player 0');
    expect(container.textContent).toContain('Player 1');

    // 最後のプレイヤーが表示されていないことを確認
    expect(container.textContent).not.toContain('Player 19');

    // "+N more" の要素が存在することを確認
    expect(container.textContent).toMatch(/\+\d+ more/);
  });

  it('showAllPlayers=trueの場合、行の途中のプレイヤーも表示されること', () => {
    // 1行に6プレイヤーまで表示できる設定で、7人のプレイヤーを用意
    const players = generatePlayers(7);
    const { container } = render(
      <BoldPreviewSvg
        worldName="Test World"
        players={players}
        showAllPlayers={true}
      />,
    );

    // 最後のプレイヤー（次の行の1人目）も表示されていることを確認
    expect(container.textContent).toContain('Player 6');

    // "+N人" の要素が存在しないことを確認
    expect(container.textContent).not.toMatch(/\+\d+人/);
  });
});
