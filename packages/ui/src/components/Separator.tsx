import * as RadixSeparator from '@radix-ui/react-separator';
import { cn } from '../cn';

export function Separator({ className, orientation = 'horizontal', ...props }: RadixSeparator.SeparatorProps) {
  return (
    <RadixSeparator.Root
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}
