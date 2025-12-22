import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { type Player, PlayerList } from '../PlayerList';

/**
 * PlayerList コンポーネントのテスト用に
 * シンプルなプレイヤーオブジェクトを生成するヘルパー。
 */
const createMockPlayer = (name: string, id: string): Player => ({
  id,
  playerId: `usr_${id}`,
  playerName: name,
  joinDateTime: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('PlayerList', () => {
  it('プレイヤー名を正しく表示する', () => {
    const players = [
      createMockPlayer('Player1', '1'),
      createMockPlayer('Player2', '2'),
    ];
    render(<PlayerList players={players} maxVisiblePlayers={5} />);

    expect(screen.getByText('Player1')).toBeTruthy();
    expect(screen.getByText('Player2')).toBeTruthy();
  });

  it('プレイヤー間にセパレーターを表示する', () => {
    const players = [
      createMockPlayer('Player1', '1'),
      createMockPlayer('Player2', '2'),
      createMockPlayer('Player3', '3'),
    ];
    render(<PlayerList players={players} maxVisiblePlayers={5} />);

    const separators = screen.getAllByText('/');
    expect(separators).toHaveLength(2);
  });

  it('最大表示数を超える場合は省略表示する', () => {
    const players = [
      createMockPlayer('Player1', '1'),
      createMockPlayer('Player2', '2'),
      createMockPlayer('Player3', '3'),
      createMockPlayer('Player4', '4'),
      createMockPlayer('Player5', '5'),
    ];
    render(<PlayerList players={players} maxVisiblePlayers={3} />);

    expect(screen.getByText('Player1')).toBeTruthy();
    expect(screen.getByText('Player2')).toBeTruthy();
    expect(screen.getByText('Player3')).toBeTruthy();
    expect(screen.queryByText('Player4')).toBeNull();
    expect(screen.queryByText('Player5')).toBeNull();
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('プレイヤー数が最大表示数と同じ場合は省略表示しない', () => {
    const players = [
      createMockPlayer('Player1', '1'),
      createMockPlayer('Player2', '2'),
      createMockPlayer('Player3', '3'),
    ];
    render(<PlayerList players={players} maxVisiblePlayers={3} />);

    expect(screen.getByText('Player1')).toBeTruthy();
    expect(screen.getByText('Player2')).toBeTruthy();
    expect(screen.getByText('Player3')).toBeTruthy();
    expect(screen.queryByText('+')).toBeNull();
  });

  it('空のプレイヤーリストを正しく処理する', () => {
    const { container } = render(
      <PlayerList players={[]} maxVisiblePlayers={5} />,
    );
    expect(container.textContent).toBe('');
  });
});
