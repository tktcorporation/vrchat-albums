import { trpcReact } from '@/trpc';
import { Ban, Loader } from 'lucide-react';
import type React from 'react';

import { cn } from '@/lib/utils';

export interface PhotoProps extends React.HTMLAttributes<HTMLDivElement> {
  photoPath: string;
  alt: string;
  objectFit?: 'cover' | 'contain';
}

export function PhotoByPath({
  photoPath,
  alt,
  objectFit = 'cover',
  ...props
}: PhotoProps) {
  const query =
    trpcReact.electronUtil.getVRChatPhotoItemData.useQuery(photoPath);
  const { data, isLoading } = query;
  // 条件レンダリングを適切に修正します
  if (isLoading) {
    return <Loader className="w-8 h-8" />;
  }

  if (!data) {
    // icon
    return <Ban className="w-8 h-8" />;
  }

  // dataがオブジェクトで、その中の画像URLを指定するプロパティが `url` だと仮定
  return (
    <div
      {...props}
      className={cn(
        'flex flex-col items-center justify-center',
        props.className,
      )}
    >
      <img src={data} className={cn('object-cover w-full h-full')} alt={alt} />
    </div>
  );
}
