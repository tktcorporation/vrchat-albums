import { Search } from 'lucide-react';
import React, { memo, useState } from 'react';
import { useI18n } from '../i18n/store';
import SearchOverlay from './SearchOverlay';

interface SearchComboboxProps {
  searchQuery: string;
  onSearch: (query: string, type?: 'world' | 'player') => void;
  className?: string;
}

/**
 * Arc/Slackスタイルの検索トリガーボタン
 * クリック時にオーバーレイ検索モーダルを開く
 */
const SearchCombobox = memo(
  ({ searchQuery, onSearch, className }: SearchComboboxProps) => {
    const { t } = useI18n();
    const [isOverlayOpen, setIsOverlayOpen] = useState(false);

    const handleOpenOverlay = () => {
      setIsOverlayOpen(true);
    };

    const handleCloseOverlay = () => {
      setIsOverlayOpen(false);
    };

    const handleSearch = (query: string, type?: 'world' | 'player') => {
      onSearch(query, type);
      setIsOverlayOpen(false);
    };

    return (
      <>
        {/* 検索トリガーボタン */}
        <button
          type="button"
          onClick={handleOpenOverlay}
          className={`relative flex items-center w-full h-7 backdrop-blur-xl rounded-2xl border-2 border-solid border-border text-foreground px-4 py-2 text-sm font-medium transition-all duration-300 hover:border-ring hover:shadow-md hover:shadow-black/5 dark:hover:shadow-white/5 ${
            className || ''
          }`}
          aria-label="検索を開く"
        >
          <Search className="h-4 w-4 text-muted-foreground/30 mr-3 flex-shrink-0" />
          <span className="flex-1 text-left text-muted-foreground/50 truncate">
            {searchQuery || t('common.search.placeholder')}
          </span>
          {searchQuery && (
            <div className="ml-2 text-xs text-muted-foreground/60 bg-gray-100/50 dark:bg-gray-800/50 px-2 py-0.5 rounded-md">
              検索中
            </div>
          )}
        </button>

        {/* 検索オーバーレイ */}
        <SearchOverlay
          isOpen={isOverlayOpen}
          onClose={handleCloseOverlay}
          onSearch={handleSearch}
          initialQuery={searchQuery}
        />
      </>
    );
  },
);

SearchCombobox.displayName = 'SearchCombobox';

export default SearchCombobox;
