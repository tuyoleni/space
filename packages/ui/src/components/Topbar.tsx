import * as RadixDropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../cn';

export interface TopbarSegmentOption {
  readonly value: string;
  readonly label: string;
}

export interface TopbarMenuProps {
  readonly label: string;
  readonly value: string;
  readonly icon?: ReactNode;
  readonly options?: readonly TopbarSegmentOption[];
  readonly onSelect?: (value: string) => void;
  readonly disabled?: boolean;
}

const triggerClasses = cn(
  // Borderless chips — a subtle surface fill is the only affordance; hover /
  // focus / open just brighten the fill (no border, no bright focus ring).
  'flex min-w-[7.5rem] flex-col items-start gap-0.5 rounded-lg bg-surface px-3 py-1.5 text-left outline-none',
  'hover:bg-surface-hover focus-visible:bg-surface-hover data-[state=open]:bg-surface-hover',
  'disabled:cursor-default disabled:hover:bg-surface',
);

/** Workspace/project/runtime-style topbar control — a labeled dropdown when `options` is given, otherwise a static read-only segment. */
export function TopbarMenu({ label, value, icon, options, onSelect, disabled }: TopbarMenuProps) {
  const content = (
    <>
      <span className="text-[10px] font-medium uppercase tracking-wide text-fg-faint">{label}</span>
      <span className="flex items-center gap-1.5 text-sm text-fg">
        {icon}
        <span className="truncate">{value}</span>
        {options && options.length > 0 && <ChevronDown size={12} className="text-fg-muted" />}
      </span>
    </>
  );

  if (!options || options.length === 0 || !onSelect) {
    return (
      <div className={cn(triggerClasses, 'cursor-default')} aria-label={`${label}: ${value}`}>
        {content}
      </div>
    );
  }

  return (
    <RadixDropdownMenu.Root>
      <RadixDropdownMenu.Trigger asChild disabled={disabled}>
        <button type="button" className={triggerClasses} aria-label={`${label}: ${value}`}>
          {content}
        </button>
      </RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-popover p-1 shadow-xl backdrop-blur-2xl"
        >
          {options.map((option) => (
            <RadixDropdownMenu.Item
              key={option.value}
              onSelect={() => onSelect(option.value)}
              className={cn(
                'flex h-8 cursor-pointer select-none items-center rounded px-2 text-sm text-fg outline-none',
                'data-[highlighted]:bg-surface-hover',
              )}
            >
              {option.label}
            </RadixDropdownMenu.Item>
          ))}
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  );
}
