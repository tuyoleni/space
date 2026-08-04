/**
 * Status Badge: a versatile badge component for showing project status,
 * build results, health indicators, and more. Supports multiple variants,
 * sizes, and dot indicators.
 */
import { cn } from '@space/ui';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
export type BadgeSize = 'sm' | 'md' | 'lg';

interface StatusBadgeProps {
  readonly variant?: BadgeVariant;
  readonly size?: BadgeSize;
  readonly dot?: boolean;
  readonly pulse?: boolean;
  readonly children: React.ReactNode;
  readonly className?: string;
}

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  default: 'bg-surface text-fg-muted border-border',
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  danger: 'bg-danger/10 text-danger border-danger/20',
  info: 'bg-accent/10 text-accent border-accent/20',
  accent: 'bg-accent text-accent-fg border-accent',
};

const SIZE_STYLES: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5 text-[9px]',
  md: 'px-2 py-0.5 text-[10px]',
  lg: 'px-2.5 py-1 text-[11px]',
};

const DOT_COLORS: Record<BadgeVariant, string> = {
  default: 'bg-fg-faint',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-accent',
  accent: 'bg-white',
};

export function StatusBadge({
  variant = 'default',
  size = 'md',
  dot = false,
  pulse = false,
  children,
  className,
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium',
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        className,
      )}
    >
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          {pulse && (
            <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', DOT_COLORS[variant])} />
          )}
          <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', DOT_COLORS[variant])} />
        </span>
      )}
      {children}
    </span>
  );
}
