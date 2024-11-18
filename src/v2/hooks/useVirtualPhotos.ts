import { useMemo, useState, useEffect } from 'react';
import { Photo } from '../types/photo';

const INITIAL_BATCH_SIZE = 20;
const BATCH_INCREMENT = 20;
const SCROLL_THRESHOLD = 1000;

export function useVirtualPhotos(photos: Photo[]) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH_SIZE);
  const [isLoading, setIsLoading] = useState(false);

  const visiblePhotos = useMemo(() => 
    photos.slice(0, visibleCount),
    [photos, visibleCount]
  );

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      
      if (documentHeight - scrollPosition < SCROLL_THRESHOLD && visibleCount < photos.length) {
        setIsLoading(true);
        // 読み込みの遅延をシミュレート
        setTimeout(() => {
          setVisibleCount(prev => Math.min(prev + BATCH_INCREMENT, photos.length));
          setIsLoading(false);
        }, 500);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [photos.length, visibleCount]);

  // 写真の配列が変更された場合はカウントをリセット
  useEffect(() => {
    setVisibleCount(INITIAL_BATCH_SIZE);
    setIsLoading(false);
  }, [photos]);

  return {
    visiblePhotos,
    isLoading: isLoading && visibleCount < photos.length,
    loadMore: () => {
      if (!isLoading && visibleCount < photos.length) {
        setIsLoading(true);
        setTimeout(() => {
          setVisibleCount(prev => Math.min(prev + BATCH_INCREMENT, photos.length));
          setIsLoading(false);
        }, 500);
      }
    }
  };
}