import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Tag,
  Users,
  X,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { Photo } from '../types/photo';
import { calculateOptimalDimensions } from '../utils/imageGenerator';
import ProgressiveImage from './ProgressiveImage';

interface PhotoModalProps {
  photo: Photo;
  onClose: () => void;
}

const PhotoModal: React.FC<PhotoModalProps> = ({ photo, onClose }) => {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [showInfo, setShowInfo] = useState(true);
  const placeholderUrl = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${photo.width} ${photo.height}'%3E%3Crect width='100%25' height='100%25' fill='%23f3f4f6'/%3E%3C/svg%3E`;

  useEffect(() => {
    const updateDimensions = () => {
      const modalPadding = 32;
      const sidebarWidth = showInfo ? 320 : 0;
      const maxWidth = window.innerWidth - sidebarWidth - modalPadding * 2;
      const maxHeight = window.innerHeight - modalPadding * 2;

      const optimal = calculateOptimalDimensions(
        photo.width,
        photo.height,
        maxWidth,
        maxHeight,
      );

      setDimensions(optimal);
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [photo, showInfo]);

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-black/95 dark:bg-black/98"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="h-full flex">
        {/* Close button */}
        <button
          type="button"
          className="absolute top-4 left-4 z-10 p-2 rounded-full bg-black/50 hover:bg-black/70 transition-colors"
          onClick={onClose}
        >
          <X className="h-5 w-5 text-white" />
        </button>

        {/* Toggle info button */}
        <button
          type="button"
          className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 hover:bg-black/70 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            setShowInfo(!showInfo);
          }}
        >
          {showInfo ? (
            <ChevronRight className="h-5 w-5 text-white" />
          ) : (
            <ChevronLeft className="h-5 w-5 text-white" />
          )}
        </button>

        {/* Image container */}
        <div
          className="flex-1 flex items-center justify-center p-8 transition-all duration-300"
          style={{
            marginRight: showInfo ? '320px' : '0',
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <div
            style={{
              width: dimensions.width,
              height: dimensions.height,
              maxWidth: '100%',
              maxHeight: '100%',
            }}
            className="relative"
          >
            <ProgressiveImage
              src={photo.url}
              placeholderSrc={placeholderUrl}
              alt={photo.fileNameWithExt.value}
              className="w-full h-full object-contain"
              loading="eager"
            />
          </div>
        </div>

        {/* Info panel - Sliding sidebar */}
        <div
          className={`fixed right-0 top-0 bottom-0 w-80 bg-white dark:bg-gray-800 transform transition-transform duration-300 ease-in-out ${
            showInfo ? 'translate-x-0' : 'translate-x-full'
          }`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <div className="h-full overflow-y-auto">
            <div className="p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">
                  photo.location.name
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
                  {photo.fileNameWithExt.value}
                </p>
              </div>

              <div className="space-y-4 text-sm">
                <div className="flex items-center text-gray-600 dark:text-gray-300">
                  <Calendar className="h-4 w-4 mr-2 flex-shrink-0" />
                  <span>{formatDate(photo.takenAt)}</span>
                </div>

                <div className="flex items-center text-gray-600 dark:text-gray-300">
                  <MapPin className="h-4 w-4 mr-2 flex-shrink-0" />
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      最終訪問: {formatDate(photo.location.joinedAt)}
                    </div>
                  </div>
                </div>

                <div className="flex items-start text-gray-600 dark:text-gray-300">
                  <Users className="h-4 w-4 mr-2 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="mb-1">一緒に訪れた人</div>
                    <div className="flex flex-wrap gap-1" />
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mb-2">
                  <Tag className="h-3.5 w-3.5 mr-1" />
                  タグ
                </div>
                <div className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
                  photo.location.description
                </div>
              </div>

              <div className="text-xs text-gray-500 dark:text-gray-400">
                解像度: {photo.width}x{photo.height} (
                {(photo.width / photo.height).toFixed(2)})
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PhotoModal;
