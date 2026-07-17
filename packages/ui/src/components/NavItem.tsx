import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export interface NavItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon: ReactNode;
  readonly label: string;
  readonly active?: boolean;
  readonly badge?: ReactNode;
}

export function NavItem({ icon, label, active = false, badge, className, type = 'button', ...props }: NavItemProps) {
  return (
    <button
      type={type}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2',
        active ? 'bg-accent/15 text-accent-hover' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
        className,
      )}
      {...props}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {badge}
    </button>
  );
}
