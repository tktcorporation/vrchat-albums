import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  PLAYER_LIST_FONT,
  calculateVisiblePlayerCount,
  measureTextWidth,
} from '../../../utils/textMeasurement';
import type { Player } from '../PlayerList';

/**
 * プレイヤーリストの表示を管理するカスタムフック。
 * 画面幅に応じて表示可能なプレイヤー数を動的に計算する。
 *
 * 背景: 以前は隠し DOM 要素の getBoundingClientRect() ループで計測していたが、
 * layout thrashing を引き起こしていた。pretext の Canvas ベース計測に置き換えることで
 * DOM リフローを排除。
 */
export const usePlayerListDisplay = (players: Player[] | null) => {
  const [maxVisiblePlayers, setMaxVisiblePlayers] = useState(6);
  const [isHovered, setIsHovered] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const [isCopied, setIsCopied] = useState(false);

  const playerListRef = useRef<HTMLSpanElement>(null);
  const playerListContainerRef = useRef<HTMLButtonElement>(null);

  /** pretext を使った幅計測関数（Canvas ベース、DOM リフローなし） */
  const measurePlayerName = useCallback(
    (name: string) => measureTextWidth(name, PLAYER_LIST_FONT),
    [],
  );

  useEffect(() => {
    /** コンテナ幅から表示可能なプレイヤー数を計算する */
    const recalculate = () => {
      if (!playerListContainerRef.current || !Array.isArray(players)) {
        return;
      }

      const containerWidth = playerListContainerRef.current.offsetWidth;
      const playerNames = players.map((p) => p.playerName);

      const count = calculateVisiblePlayerCount(
        playerNames,
        containerWidth,
        measurePlayerName,
      );
      setMaxVisiblePlayers(count);
    };

    recalculate();

    // ResizeObserverを使用してコンテナのサイズ変更を監視
    const resizeObserver = new ResizeObserver(recalculate);
    if (playerListContainerRef.current) {
      resizeObserver.observe(playerListContainerRef.current);
    }

    // ウィンドウリサイズ時も再計算
    window.addEventListener('resize', recalculate);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', recalculate);
    };
  }, [players, measurePlayerName]);

  useEffect(() => {
    /** ツールチップの位置をプレイヤーリストの下に更新する */
    const updateTooltipPosition = () => {
      if (playerListRef.current) {
        const rect = playerListRef.current.getBoundingClientRect();
        setTooltipPosition({
          top: rect.bottom + 8,
          left: rect.left,
        });
      }
    };

    updateTooltipPosition();
    window.addEventListener('resize', updateTooltipPosition);
    window.addEventListener('scroll', updateTooltipPosition);

    return () => {
      window.removeEventListener('resize', updateTooltipPosition);
      window.removeEventListener('scroll', updateTooltipPosition);
    };
  }, []);

  /** ツールチップの追従用マウスムーブハンドラ */
  const handleMouseMove = (event: React.MouseEvent) => {
    setTooltipPosition({
      top: event.clientY + 16,
      left: event.clientX,
    });
  };

  /** コピー完了を一時的に表示する */
  const handleCopyPlayers = () => {
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return {
    maxVisiblePlayers,
    isHovered,
    setIsHovered,
    tooltipPosition,
    isCopied,
    playerListRef,
    playerListContainerRef,
    handleMouseMove,
    handleCopyPlayers,
  };
};
