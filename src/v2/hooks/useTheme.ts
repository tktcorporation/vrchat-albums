import { useContext } from 'react';

import { ThemeContext } from '../contexts/ThemeContext';

/**
 * ThemeSelector コンポーネントなどから利用され、
 * 現在のテーマ状態と切り替え関数を取得する。
 */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
