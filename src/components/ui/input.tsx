import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * フォームや検索欄で使用される標準的な入力フィールド。
 * `PhotoGallery/Header` など複数の画面で文字入力を受け付けるために利用する。
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background/50 backdrop-blur-sm px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground transition-all duration-200 hover:bg-background/70 hover:border-input/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:bg-background focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 shadow-sm',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
