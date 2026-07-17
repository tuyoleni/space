import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly 'aria-label': string;
  readonly active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, active = false, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors',
        'hover:bg-surface-hover hover:text-fg',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2',
        active && 'bg-surface-hover text-fg',
        className,
      )}
      {...props}
    />
  );
});
