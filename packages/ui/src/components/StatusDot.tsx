import { cn } from '../cn';

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

export interface StatusDotProps {
  readonly tone?: StatusTone;
  /** Raw CSS color, e.g. a per-project identity color — takes precedence over `tone`. */
  readonly color?: string;
  readonly pulse?: boolean;
  readonly className?: string;
  readonly label?: string;
}

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-fg-faint',
  accent: 'bg-accent',
};

export function StatusDot({ tone = 'neutral', color, pulse = false, className, label }: StatusDotProps) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', !color && TONE_CLASSES[tone], pulse && 'animate-pulse', className)}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}
