import { useEffect, useRef, useState } from 'react';

/**
 * クエリキューイング機能を提供するカスタムフック
 * 大量のクエリが同時実行されることを防ぎ、段階的に実行する
 */
export const useQueryQueue = (isVisible: boolean, priority = 0, delay = 0) => {
  const [canExecuteQuery, setCanExecuteQuery] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const priorityRef = useRef(priority);

  // グローバルなクエリカウンターとキューを管理
  // 実際のアプリケーションでは、Context APIやグローバル状態管理を使用することを推奨
  useEffect(() => {
    priorityRef.current = priority;
  }, [priority]);

  useEffect(() => {
    if (isVisible) {
      // 優先度に応じて遅延時間を調整（さらに削減）
      const adjustedDelay = delay + priorityRef.current * 10;

      // クエリ実行の許可を遅延付きで設定
      timeoutRef.current = setTimeout(() => {
        setCanExecuteQuery(true);
      }, adjustedDelay);
    } else {
      // 非表示になった場合はクエリ実行を停止
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setCanExecuteQuery(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isVisible, delay]);

  return canExecuteQuery;
};
