import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { extractDominantColors } from '../utils/colorExtractor';

interface Player {
  id: string;
  playerId: string | null;
  playerName: string;
  joinDateTime: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface BoldPreviewProps {
  worldName: string | null;
  imageUrl?: string | null;
  imageBase64?: string | null;
  players: Player[] | null;
  previewRef?: React.RefObject<SVGSVGElement>;
  showAllPlayers?: boolean;
}

/**
 * VRChat のワールド入室イベントを共有用に表示する SVG を描画する。
 */
export function BoldPreviewSvg({
  worldName,
  imageUrl,
  imageBase64,
  players,
  previewRef: externalPreviewRef,
  showAllPlayers,
}: BoldPreviewProps) {
  const [visiblePlayers, setVisiblePlayers] = useState<Player[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [colors, setColors] = useState({
    primary: 'rgb(59, 130, 246)',
    secondary: 'rgb(147, 51, 234)',
    accent: 'rgb(79, 70, 229)',
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const tempContainerRef = useRef<HTMLDivElement>(null);
  const internalPreviewRef = useRef<SVGSVGElement>(null);
  const previewRef = externalPreviewRef || internalPreviewRef;

  const imageSource = imageBase64
    ? `data:image/png;base64,${imageBase64}`
    : imageUrl;

  useEffect(() => {
    if (imageSource) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const extractedColors = extractDominantColors(img);
        setColors(extractedColors);
      };
      img.src = imageSource;
    }
  }, [imageSource]);

  useEffect(() => {
    if (!tempContainerRef.current || !players) return;

    const containerWidth = 740;
    const gap = 8;
    const visible: Player[] = [];

    const reservedWidth = 100;
    const effectiveWidth = containerWidth - reservedWidth;

    let currentRow = 0;
    let currentWidth = 0;

    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.visibility = 'hidden';
    tempDiv.style.padding = '6px 12px';
    tempDiv.style.whiteSpace = 'nowrap';
    tempDiv.style.fontSize = '14px';
    tempDiv.style.fontWeight = '500';
    document.body.appendChild(tempDiv);

    for (const player of players) {
      tempDiv.textContent = player.playerName;
      const width = tempDiv.getBoundingClientRect().width;

      if (currentWidth + width + gap > effectiveWidth) {
        currentRow++;
        currentWidth = width + gap;
      } else {
        currentWidth += width + gap;
      }

      if (showAllPlayers || currentRow < 2) {
        visible.push(player);
      } else {
        break;
      }
    }

    document.body.removeChild(tempDiv);
    setVisiblePlayers(visible);
    setHiddenCount(showAllPlayers ? 0 : players.length - visible.length);
  }, [players, showAllPlayers]);
  /**
   * プレイヤー表示数に応じてSVG全体の高さを計算するヘルパー。
   * 同ファイル内でプレビューサイズを決定するためにのみ使用される。
   */
  const calculatePreviewHeight = () => {
    if (!showAllPlayers) return 600;
    const playerCount = players?.length || 0;
    const playersPerRow = Math.floor((740 - 100) / (100 + 8));
    const additionalRows = Math.max(
      0,
      Math.ceil(playerCount / playersPerRow) - 2,
    );
    const additionalHeight = additionalRows * 30 + (additionalRows > 0 ? 8 : 0);
    return 600 + additionalHeight;
  };

  const previewHeight = calculatePreviewHeight();
  const playersSectionY = 480;
  const playerListHeight = showAllPlayers
    ? previewHeight - playersSectionY - 8
    : 76;

  return (
    <svg
      ref={previewRef}
      className="max-w-[100%] max-h-[100%]"
      viewBox={`0 0 800 ${previewHeight}`}
      style={{
        background: '#7FB5B5',
      }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>VRChat World Join Preview</title>
      <defs>
        <filter id="blur-effect">
          <feGaussianBlur stdDeviation="40" />
          <feColorMatrix type="saturate" values="1.2" />
        </filter>

        <filter id="soft-shadow">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.3" />
        </filter>

        {imageSource && (
          <>
            <pattern
              id="bg-image"
              patternUnits="userSpaceOnUse"
              width="800"
              height={previewHeight}
            >
              <g transform={`translate(400 ${previewHeight / 2})`}>
                <image
                  href={imageSource}
                  x="-600"
                  y={-previewHeight}
                  width="1200"
                  height={previewHeight * 2}
                  preserveAspectRatio="xMidYMid slice"
                  crossOrigin="anonymous"
                  style={{
                    transformOrigin: 'center center',
                  }}
                />
              </g>
            </pattern>

            <pattern
              id="main-image"
              patternUnits="userSpaceOnUse"
              x="80"
              y="100"
              width="640"
              height="360"
            >
              <image
                href={imageSource}
                x="0"
                y="0"
                width="640"
                height="360"
                preserveAspectRatio="xMidYMid slice"
                crossOrigin="anonymous"
              />
            </pattern>
          </>
        )}

        <linearGradient
          id="overlay-gradient"
          x1="0"
          y1="0"
          x2="0"
          y2={previewHeight}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor={colors.primary} stopOpacity="0.4" />
          <stop offset="100%" stopColor={colors.secondary} stopOpacity="0.4" />
        </linearGradient>
      </defs>

      {imageSource && (
        <>
          <rect
            width="100%"
            height="100%"
            fill="url(#bg-image)"
            filter="url(#blur-effect)"
            opacity="0.8"
          />

          <rect width="100%" height="100%" fill="url(#overlay-gradient)" />

          <rect
            x="80"
            y="100"
            width="640"
            height="360"
            fill="url(#main-image)"
            rx="16"
            filter="url(#soft-shadow)"
          />
        </>
      )}

      <g transform="translate(32, 32)">
        <g>
          <text
            x="0"
            y="0"
            fontSize="32"
            fontWeight="700"
            fill="white"
            dominantBaseline="hanging"
            filter="url(#soft-shadow)"
          >
            {worldName || 'Unknown World'}
          </text>
          <rect
            x="0"
            y="42"
            width="240"
            height="4"
            rx="2"
            fill={colors.accent}
            opacity="0.9"
            filter="url(#soft-shadow)"
          />
        </g>
      </g>

      <g transform={`translate(32, ${playersSectionY})`}>
        <g>
          <text
            x="0"
            y="0"
            fontSize="14"
            fontWeight="600"
            fill="rgba(255, 255, 255, 0.7)"
            dominantBaseline="hanging"
            letterSpacing="0.05em"
          >
            PLAYERS ({players?.length || 0})
          </text>
        </g>

        <foreignObject x="0" y="24" width="740" height={playerListHeight}>
          <div
            ref={tempContainerRef}
            style={{ position: 'absolute', visibility: 'hidden' }}
          />
          <div
            ref={containerRef}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              width: '100%',
              alignContent: 'flex-start',
              position: 'relative',
              height: '100%',
              overflow: 'hidden',
              paddingBottom: '16px',
            }}
          >
            {(showAllPlayers ? players : visiblePlayers)?.map((player) => (
              <div
                key={player.id}
                style={{
                  background: 'rgba(0, 0, 0, 0.3)',
                  padding: '6px 12px',
                  borderRadius: '16px',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: 500,
                  display: 'inline-block',
                  whiteSpace: 'nowrap',
                  marginBottom: '2px',
                  height: '30px',
                  lineHeight: '18px',
                  boxSizing: 'border-box',
                }}
              >
                {player.playerName}
              </div>
            ))}
            {!showAllPlayers && hiddenCount > 0 && (
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.3)',
                  padding: '6px 12px',
                  borderRadius: '16px',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: 500,
                  display: 'inline-block',
                  whiteSpace: 'nowrap',
                  marginBottom: '2px',
                  height: '30px',
                  lineHeight: '18px',
                  boxSizing: 'border-box',
                }}
              >
                <span>+{hiddenCount} more</span>
              </div>
            )}
          </div>
        </foreignObject>
      </g>
    </svg>
  );
}
