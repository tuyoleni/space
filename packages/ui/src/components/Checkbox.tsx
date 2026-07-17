import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '../cn';

export interface CheckboxProps {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly 'aria-label'?: string;
  readonly id?: string;
  readonly className?: string;
}

export function Checkbox({ checked, onCheckedChange, disabled, className, ...props }: CheckboxProps) {
  return (
    <RadixCheckbox.Root
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      disabled={disabled}
      className={cn(
        'inline-flex h-4 w-4 items-center justify-center rounded border border-border-strong bg-app-bg',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2',
        className,
      )}
      {...props}
    >
      <RadixCheckbox.Indicator>
        <Check size={11} className="text-accent-fg" strokeWidth={3} />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}
