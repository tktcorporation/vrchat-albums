import type React from 'react';
import { useEffect, useRef, useState } from 'react';

import type { Player } from '../PlayerList';

/**
 * プレイヤーリストの表示を管理するカスタムフック
 * 画面幅に応じて表示可能なプレイヤー数を動的に計算
 */
export const usePlayerListDisplay = (players: Player[] | null) => {
  const [maxVisiblePlayers, setMaxVisiblePlayers] = useState(6);
  const [isHovered, setIsHovered] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const [isCopied, setIsCopied] = useState(false);

  const playerListRef = useRef<HTMLSpanElement>(null);
  const playerListContainerRef = useRef<HTMLDivElement>(null);
  // パフォーマンス改善: 幅計算用の一時DOM要素をキャッシュ
  const measureElementRef = useRef<HTMLDivElement | null>(null);

  // 一時測定要素の初期化とクリーンアップ
  useEffect(() => {
    // 測定用DOM要素を一度だけ作成
    if (!measureElementRef.current) {
      const tempDiv = document.createElement('div');
      tempDiv.style.position = 'absolute';
      tempDiv.style.visibility = 'hidden';
      tempDiv.style.whiteSpace = 'nowrap';
      tempDiv.style.fontSize = '0.875rem'; // text-sm
      tempDiv.style.pointerEvents = 'none'; // イベントを無効化
      document.body.appendChild(tempDiv);
      measureElementRef.current = tempDiv;
    }

    // クリーンアップ時に要素を削除
    return () => {
      if (measureElementRef.current) {
        document.body.removeChild(measureElementRef.current);
        measureElementRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    /** コンテナ幅から表示可能なプレイヤー数を計算する */
    const calculateMaxVisiblePlayers = () => {
      if (
        !playerListContainerRef.current ||
        !Array.isArray(players) ||
        !measureElementRef.current
      )
        return;

      const containerWidth = playerListContainerRef.current.offsetWidth;
      const separatorWidth = 24; // セパレータ（ / ）の幅
      const moreTextWidth = 48; // "/ +X" テキストの幅
      const tempDiv = measureElementRef.current;

      let totalWidth = 0;
      let maxPlayers = 0;

      for (let i = 0; i < players.length; i++) {
        tempDiv.textContent = players[i].playerName;
        const playerNameWidth = tempDiv.getBoundingClientRect().width;
        const widthWithSeparator =
          playerNameWidth + (i < players.length - 1 ? separatorWidth : 0);

        if (
          totalWidth +
            widthWithSeparator +
            (i < players.length - 1 ? moreTextWidth : 0) >
          containerWidth
        ) {
          break;
        }

        totalWidth += widthWithSeparator;
        maxPlayers = i + 1;
      }

      setMaxVisiblePlayers(Math.max(3, maxPlayers)); // 最低3人は表示
    };

    // 初回計算
    calculateMaxVisiblePlayers();

    // ResizeObserverを使用してコンテナのサイズ変更を監視
    const resizeObserver = new ResizeObserver(calculateMaxVisiblePlayers);
    if (playerListContainerRef.current) {
      resizeObserver.observe(playerListContainerRef.current);
    }

    // ウィンドウリサイズ時も再計算
    window.addEventListener('resize', calculateMaxVisiblePlayers);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', calculateMaxVisiblePlayers);
    };
  }, [players]);

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
