import type React from 'react';
import { useEffect, useState } from 'react';

interface ProgressiveImageProps {
  src: string;
  placeholderSrc: string;
  alt: string;
  className?: string;
  sizes?: string;
  srcSet?: string;
  loading?: 'lazy' | 'eager';
}

/**
 * 低解像度画像を先に表示し、読み込み完了後に本画像へ差し替えるコンポーネント。
 * PhotoCard 内で使用され、スクロール時の視覚的な滑らかさを向上させる。
 */
const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
  src,
  placeholderSrc,
  alt,
  className = '',
  sizes,
  srcSet,
  loading = 'lazy',
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(placeholderSrc);

  useEffect(() => {
    const img = new Image();
    img.src = src;
    img.addEventListener('load', () => {
      setIsLoaded(true);
      setCurrentSrc(src);
    });
  }, [src]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Placeholder/blur image */}
      <img
        src={placeholderSrc}
        alt=""
        aria-hidden="true"
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
          isLoaded ? 'opacity-0' : 'opacity-100'
        } blur-xl scale-110`}
      />

      {/* Main image */}
      <img
        src={currentSrc}
        alt={alt}
        sizes={sizes}
        srcSet={srcSet}
        loading={loading}
        onLoad={() => setIsLoaded(true)}
        className={`${className} absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
        decoding="async"
      />
    </div>
  );
};

export default ProgressiveImage;
