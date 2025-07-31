import { trpcReact } from '@/trpc';
import { Globe, Search, User, X } from 'lucide-react';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ICON_SIZE } from '../constants/ui';
import { useI18n } from '../i18n/store';

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (query: string, type?: 'world' | 'player') => void;
  initialQuery?: string;
}

interface SearchSuggestion {
  id: string;
  type: 'world' | 'player' | 'recent';
  value: string;
  label: string;
}

/**
 * Arc/Slackスタイルのオーバーレイ検索UI
 * 検索バークリック時に画面上部に展開される検索モーダル
 */
const SearchOverlay = memo(
  ({ isOpen, onClose, onSearch, initialQuery = '' }: SearchOverlayProps) => {
    const { t } = useI18n();
    const [query, setQuery] = useState(initialQuery);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // デバウンス用のクエリ
    const [debouncedQuery, setDebouncedQuery] = useState('');

    // デバウンス処理
    useEffect(() => {
      const timer = setTimeout(() => {
        setDebouncedQuery(query);
      }, 200);
      return () => clearTimeout(timer);
    }, [query]);

    // よく訪れるワールドの取得（初期表示用）
    const { data: frequentWorlds = [] } =
      trpcReact.logInfo.getVRCWorldJoinLogList.useQuery(undefined, {
        enabled: isOpen,
        select: (data) => {
          // ワールド参加回数でソートしてよく訪れるワールドを作成
          const worldCounts = data.reduce(
            (acc, log) => {
              acc[log.worldName] = (acc[log.worldName] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          );

          return Object.entries(worldCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3)
            .map(([worldName]) => worldName);
        },
        staleTime: 1000 * 60 * 5, // 5分間キャッシュ
      });

    // よく遊ぶプレイヤーの取得（初期表示用）
    const { data: frequentPlayers = [] } =
      trpcReact.logInfo.getFrequentPlayerNames.useQuery(
        { limit: 3 },
        {
          enabled: isOpen,
          staleTime: 1000 * 60 * 5, // 5分間キャッシュ
        },
      );

    // 動的検索候補の取得
    const { data: worldSuggestions = [], isLoading: isLoadingWorlds } =
      trpcReact.logInfo.getWorldNameSuggestions.useQuery(
        { query: debouncedQuery, limit: 5 },
        {
          enabled: isOpen && debouncedQuery.length > 0,
          staleTime: 1000 * 60 * 5,
        },
      );

    const { data: playerSuggestions = [], isLoading: isLoadingPlayers } =
      trpcReact.logInfo.getPlayerNameSuggestions.useQuery(
        { query: debouncedQuery, limit: 5 },
        {
          enabled: isOpen && debouncedQuery.length > 0,
          staleTime: 1000 * 60 * 5,
        },
      );

    // 検索候補の統合
    const suggestions: SearchSuggestion[] = React.useMemo(() => {
      if (debouncedQuery.length === 0) {
        // 初期状態：よく訪れるワールドとよく遊ぶプレイヤーを表示
        return [
          ...frequentWorlds.map((world, index) => ({
            id: `frequent-world-${index}`,
            type: 'world' as const,
            value: world,
            label: world,
          })),
          ...frequentPlayers.map((player, index) => ({
            id: `frequent-player-${index}`,
            type: 'player' as const,
            value: player,
            label: player,
          })),
        ];
      }

      // 検索中：動的候補を表示
      return [
        ...worldSuggestions.map((world, index) => ({
          id: `world-${index}`,
          type: 'world' as const,
          value: world,
          label: world,
        })),
        ...playerSuggestions.map((player, index) => ({
          id: `player-${index}`,
          type: 'player' as const,
          value: player,
          label: player,
          icon: '👤',
        })),
      ];
    }, [
      debouncedQuery,
      frequentWorlds,
      frequentPlayers,
      worldSuggestions,
      playerSuggestions,
    ]);

    // キーボードナビゲーション
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            setHighlightedIndex((prev) =>
              prev < suggestions.length - 1 ? prev + 1 : prev,
            );
            break;
          case 'ArrowUp':
            e.preventDefault();
            setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
            break;
          case 'Enter':
            e.preventDefault();
            if (suggestions[highlightedIndex]) {
              handleSelect(suggestions[highlightedIndex]);
            } else {
              handleSearch();
            }
            break;
          case 'Escape':
            handleClose();
            break;
        }
      },
      [suggestions, highlightedIndex, query],
    );

    // 候補選択
    const handleSelect = useCallback(
      (suggestion: SearchSuggestion) => {
        setQuery(suggestion.value);
        onSearch(
          suggestion.value,
          suggestion.type === 'recent' ? undefined : suggestion.type,
        );
        onClose();
      },
      [onSearch, onClose],
    );

    // 直接検索
    const handleSearch = useCallback(() => {
      const trimmedQuery = query.trim();
      onSearch(trimmedQuery);
      onClose();
    }, [query, onSearch, onClose]);

    // モーダルを閉じる
    const handleClose = useCallback(() => {
      setQuery('');
      setHighlightedIndex(0);
      onClose();
    }, [onClose]);

    // モーダル外クリックで閉じる
    const handleBackdropClick = useCallback(
      (e: React.MouseEvent) => {
        // クリックされた要素が背景（backdrop）自体の場合のみ閉じる
        if (e.target === e.currentTarget) {
          handleClose();
        }
      },
      [handleClose],
    );

    // フォーカス管理
    useEffect(() => {
      if (isOpen && inputRef.current) {
        inputRef.current.focus();
        if (initialQuery) {
          setQuery(initialQuery);
        }
      }
    }, [isOpen, initialQuery]);

    // ハイライトインデックスのリセット
    useEffect(() => {
      setHighlightedIndex(0);
    }, [suggestions.length]);

    if (!isOpen) return null;

    const isLoading = isLoadingWorlds || isLoadingPlayers;

    return (
      <div
        className="fixed inset-0 z-50 bg-black/20 dark:bg-black/40 backdrop-blur-sm"
        onClick={handleBackdropClick}
        onKeyDown={(e) => {
          if (e.key === 'Escape') handleClose();
        }}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="absolute top-0 left-0 right-0 p-4 pointer-events-none">
          <div
            className="max-w-2xl mx-auto bg-white/85 dark:bg-gray-900/85 backdrop-blur-2xl rounded-2xl border border-gray-200/20 dark:border-gray-700/30 shadow-2xl pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {/* 検索入力部分 */}
            <div className="flex items-center p-4 border-b border-gray-200/30 dark:border-gray-700/30">
              <Search
                className={`${ICON_SIZE.md.class} text-muted-foreground/40 mr-3 flex-shrink-0`}
              />
              <input
                ref={inputRef}
                type="text"
                className="flex-1 bg-transparent text-lg font-medium placeholder:text-muted-foreground/50 focus:outline-none"
                placeholder={t('common.search.placeholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    onSearch('');
                  }}
                  className="ml-3 p-1.5 hover:bg-gray-100/50 dark:hover:bg-gray-800/50 rounded-lg transition-colors duration-150"
                  aria-label="検索をクリア"
                >
                  <X
                    className={`${ICON_SIZE.sm.class} text-muted-foreground/60`}
                  />
                </button>
              )}
            </div>

            {/* 検索候補部分 */}
            <div className="max-h-80 overflow-y-auto scrollbar-hide">
              {isLoading && debouncedQuery.length > 0 ? (
                <div className="p-6 text-center text-muted-foreground/80">
                  検索中...
                </div>
              ) : suggestions.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground/80">
                  {debouncedQuery.length > 0
                    ? '候補が見つかりません'
                    : 'よく利用する項目を読み込み中...'}
                </div>
              ) : (
                <div className="p-2">
                  {debouncedQuery.length === 0 && (
                    <div className="px-3 py-2 text-xs font-medium text-muted-foreground/60 uppercase tracking-wide">
                      よく利用する項目
                    </div>
                  )}
                  {suggestions.map((suggestion, index) => (
                    <div
                      key={suggestion.id}
                      className={`flex items-center px-3 py-2.5 rounded-xl cursor-pointer transition-colors duration-150 ${
                        index === highlightedIndex
                          ? 'bg-primary/10 dark:bg-primary/20'
                          : 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50'
                      }`}
                      onClick={() => handleSelect(suggestion)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelect(suggestion);
                        }
                      }}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      role="option"
                      aria-selected={index === highlightedIndex}
                      tabIndex={0}
                    >
                      {suggestion.type === 'world' ? (
                        <Globe
                          className={`${ICON_SIZE.sm.class} mr-3 text-muted-foreground`}
                        />
                      ) : (
                        <User
                          className={`${ICON_SIZE.sm.class} mr-3 text-muted-foreground`}
                        />
                      )}
                      <span className="flex-1 font-medium text-gray-900 dark:text-gray-100">
                        {suggestion.label}
                      </span>
                      {suggestion.type === 'world' && (
                        <span className="text-xs text-muted-foreground/60 bg-gray-100/50 dark:bg-gray-800/50 px-2 py-1 rounded-md">
                          ワールド
                        </span>
                      )}
                      {suggestion.type === 'player' && (
                        <span className="text-xs text-muted-foreground/60 bg-gray-100/50 dark:bg-gray-800/50 px-2 py-1 rounded-md">
                          プレイヤー
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* フッター（オプション） */}
            {query.trim() && (
              <div className="border-t border-gray-200/30 dark:border-gray-700/30 p-3">
                <button
                  type="button"
                  onClick={handleSearch}
                  className="w-full flex items-center justify-center px-4 py-2 bg-primary/10 hover:bg-primary/20 dark:bg-primary/20 dark:hover:bg-primary/30 text-primary font-medium rounded-xl transition-colors duration-150"
                >
                  <Search className={`${ICON_SIZE.sm.class} mr-2`} />「{query}
                  」で検索
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);

SearchOverlay.displayName = 'SearchOverlay';

export default SearchOverlay;
