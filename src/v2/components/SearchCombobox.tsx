import { Search } from 'lucide-react';
import { memo, useState } from 'react';
import { createPortal } from 'react-dom';

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
          className={`relative flex items-center w-full h-8 bg-muted/50 rounded-xl px-3.5 text-sm font-medium transition-all duration-200 ease-spring hover:bg-muted/70 hover:shadow-subtle hover:scale-[1.01] active:scale-[0.99] ${
            className ?? ''
          }`}
          aria-label="検索を開く"
        >
          <Search className="h-3.5 w-3.5 text-muted-foreground/30 mr-3 flex-shrink-0" />
          <span className="flex-1 text-left text-muted-foreground/40 truncate">
            {searchQuery || t('common.search.placeholder')}
          </span>
          {searchQuery && (
            <div className="ml-2 text-xs text-muted-foreground/60 bg-muted/40 px-2 py-0.5 rounded-lg">
              検索中
            </div>
          )}
        </button>

        {/* 検索オーバーレイ — ヘッダーの backdrop-filter スタッキングコンテキストを超えるため Portal 経由 */}
        {createPortal(
          <SearchOverlay
            isOpen={isOverlayOpen}
            onClose={handleCloseOverlay}
            onSearch={handleSearch}
            initialQuery={searchQuery}
          />,
          document.body,
        )}
      </>
    );
  },
);

SearchCombobox.displayName = 'SearchCombobox';

export default SearchCombobox;
