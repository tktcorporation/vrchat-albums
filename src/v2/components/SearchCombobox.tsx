import { trpcReact } from '@/trpc';
import { Search } from 'lucide-react';
import React, { memo, useCallback, useEffect, useState } from 'react';
import { Combobox, type ComboboxOption } from '../../components/ui/combobox';
import { useI18n } from '../i18n/store';

interface SearchComboboxProps {
  searchQuery: string;
  onSearch: (query: string) => void;
  className?: string;
}

/**
 * 検索候補付きのコンボボックス型検索バー
 * 検索ボックスに直接入力でき、候補が表示される
 */
const SearchCombobox = memo(
  ({ searchQuery, onSearch, className }: SearchComboboxProps) => {
    const { t } = useI18n();
    const [debouncedQuery, setDebouncedQuery] = useState('');

    // デバウンス処理
    useEffect(() => {
      const timer = setTimeout(() => {
        setDebouncedQuery(searchQuery);
      }, 300);

      return () => clearTimeout(timer);
    }, [searchQuery]);

    // ワールド名の候補を取得
    const { data: worldSuggestions = [], isLoading: isLoadingWorlds } =
      trpcReact.logInfo.getWorldNameSuggestions.useQuery(
        { query: debouncedQuery, limit: 5 },
        {
          enabled: debouncedQuery.length > 0,
          staleTime: 1000 * 60 * 5, // 5分間キャッシュ
        },
      );

    // プレイヤー名の候補を取得
    const { data: playerSuggestions = [], isLoading: isLoadingPlayers } =
      trpcReact.logInfo.getPlayerNameSuggestions.useQuery(
        { query: debouncedQuery, limit: 5 },
        {
          enabled: debouncedQuery.length > 0,
          staleTime: 1000 * 60 * 5, // 5分間キャッシュ
        },
      );

    // 候補オプションを統合
    const options: ComboboxOption[] = [
      ...worldSuggestions.map((world) => ({
        value: `world:${world}`,
        label: `🌍 ${world}`,
      })),
      ...playerSuggestions.map((player) => ({
        value: `player:${player}`,
        label: `👤 ${player}`,
      })),
    ];

    const handleSelect = useCallback((_value: string) => {
      // 候補選択時は何も追加しない（onSearchChangeで既に更新済み）
    }, []);

    const isLoading = isLoadingWorlds || isLoadingPlayers;

    return (
      <div className={`relative ${className || ''}`}>
        <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none z-10">
          <Search className="h-3 w-3 text-muted-foreground" />
        </div>
        <Combobox
          options={options}
          searchQuery={searchQuery}
          onSearchChange={onSearch}
          onSelect={handleSelect}
          placeholder={t('common.search.placeholder')}
          emptyText={
            debouncedQuery.length > 0
              ? '候補が見つかりません'
              : '検索文字を入力してください'
          }
          loading={isLoading}
          className="pl-7 h-7 text-xs"
        />
      </div>
    );
  },
);

SearchCombobox.displayName = 'SearchCombobox';

export default SearchCombobox;
