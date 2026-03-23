import { Laptop } from 'lucide-react';
import { memo } from 'react';
import { match } from 'ts-pattern';

import { ICON_SIZE } from '../../constants/ui';

interface PlatformBadgeProps {
  platform: string;
}

/**
 * プラットフォーム情報を表示するバッジコンポーネント
 * VRChat のプラットフォーム（PC、Quest など）を視覚的に表示
 */
export const PlatformBadge = memo(({ platform }: PlatformBadgeProps) => {
  const platformName = match(platform)
    .with('standalonewindows', () => 'PC')
    .with('android', () => 'Quest')
    .otherwise((p) => p);
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-sm font-medium bg-muted text-muted-foreground">
      <Laptop className={`${ICON_SIZE.xs.class} mr-1`} />
      {platformName}
    </span>
  );
});

PlatformBadge.displayName = 'PlatformBadge';
