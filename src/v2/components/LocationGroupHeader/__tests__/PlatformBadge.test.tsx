import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlatformBadge } from '../PlatformBadge';

describe('PlatformBadge', () => {
  it('PC プラットフォームを正しく表示する', () => {
    render(<PlatformBadge platform="standalonewindows" />);
    expect(screen.getByText('PC')).toBeTruthy();
  });

  it('Quest プラットフォームを正しく表示する', () => {
    render(<PlatformBadge platform="android" />);
    expect(screen.getByText('Quest')).toBeTruthy();
  });

  it('その他のプラットフォームをそのまま表示する', () => {
    render(<PlatformBadge platform="custom-platform" />);
    expect(screen.getByText('custom-platform')).toBeTruthy();
  });

  it('アイコンが表示される', () => {
    const { container } = render(
      <PlatformBadge platform="standalonewindows" />,
    );
    const icon = container.querySelector('svg');
    expect(icon).toBeTruthy();
    expect(icon?.classList.contains('h-3')).toBe(true);
    expect(icon?.classList.contains('w-3')).toBe(true);
  });

  it('正しいスタイルクラスが適用される', () => {
    const { container } = render(
      <PlatformBadge platform="standalonewindows" />,
    );
    const badge = container.querySelector('span');
    expect(badge).toBeTruthy();
    expect(badge?.classList.contains('inline-flex')).toBe(true);
    expect(badge?.classList.contains('items-center')).toBe(true);
    expect(badge?.classList.contains('px-2')).toBe(true);
    expect(badge?.classList.contains('py-0.5')).toBe(true);
    expect(badge?.classList.contains('rounded')).toBe(true);
    expect(badge?.classList.contains('text-sm')).toBe(true);
    expect(badge?.classList.contains('font-medium')).toBe(true);
  });
});
