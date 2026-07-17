import * as RadixScrollArea from '@radix-ui/react-scroll-area';
import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface ScrollAreaProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly viewportClassName?: string;
}

export function ScrollArea({ children, className, viewportClassName }: ScrollAreaProps) {
  return (
    <RadixScrollArea.Root className={cn('overflow-hidden', className)}>
      <RadixScrollArea.Viewport className={cn('h-full w-full', viewportClassName)}>{children}</RadixScrollArea.Viewport>
      <RadixScrollArea.Scrollbar
        orientation="vertical"
        className="flex w-2.5 touch-none select-none p-0.5 transition-colors hover:bg-surface-hover"
      >
        <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-border-strong" />
      </RadixScrollArea.Scrollbar>
      <RadixScrollArea.Scrollbar
        orientation="horizontal"
        className="flex h-2.5 touch-none select-none p-0.5 transition-colors hover:bg-surface-hover"
      >
        <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-border-strong" />
      </RadixScrollArea.Scrollbar>
    </RadixScrollArea.Root>
  );
}
