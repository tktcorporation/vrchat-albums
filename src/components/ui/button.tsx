import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'glass-button text-primary-foreground hover:shadow-glass-hover hover:scale-105',
        destructive:
          'bg-destructive/80 backdrop-blur-sm border border-destructive/30 text-destructive-foreground hover:bg-destructive/90 hover:scale-105',
        outline:
          'border border-input/50 backdrop-blur-sm bg-background/50 hover:bg-accent/80 hover:text-accent-foreground hover:scale-105',
        secondary:
          'backdrop-blur-sm bg-secondary/80 border border-secondary/30 text-secondary-foreground hover:bg-secondary/90 hover:scale-105',
        ghost:
          'backdrop-blur-sm hover:bg-accent/60 hover:text-accent-foreground hover:scale-105',
        link: 'text-primary underline-offset-4 hover:underline',
        icon: '',
        glass:
          'glass backdrop-blur-md border border-glass-border hover:shadow-glass-hover hover:scale-105',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

/**
 * 各種画面で利用されるスタイリング済みのボタンコンポーネント。
 * `variant` や `size` により見た目を変更でき、`AppHeader` や設定画面など
 * 幅広いコンポーネントで使われている。
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
