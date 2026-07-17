import type { HTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '../cn';

export type InlineBannerVariant = 'error' | 'success' | 'info';

export interface InlineBannerProps extends HTMLAttributes<HTMLDivElement> {
  readonly variant?: InlineBannerVariant;
}

const VARIANT_CLASSES: Record<InlineBannerVariant, string> = {
  error: 'border-danger/30 bg-danger/10 text-danger',
  success: 'border-success/30 bg-success/10 text-success',
  info: 'border-accent/30 bg-accent/10 text-accent-hover',
};

const VARIANT_ICON: Record<InlineBannerVariant, typeof AlertTriangle> = {
  error: AlertTriangle,
  success: CheckCircle2,
  info: Info,
};

/**
 * Replaces raw `<p role="alert">`/`<p role="status">` text — spec 28 still
 * requires the announcement role, this just gives it real chrome. Errors
 * default to `role="alert"` (interrupts screen readers immediately);
 * success/info default to `role="status"` (polite, non-interrupting).
 */
export function InlineBanner({ variant = 'info', role, className, children, ...props }: InlineBannerProps) {
  const Icon = VARIANT_ICON[variant];
  return (
    <div
      role={role ?? (variant === 'error' ? 'alert' : 'status')}
      className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', VARIANT_CLASSES[variant], className)}
      {...props}
    >
      <Icon size={15} className="mt-0.5 shrink-0" />
      <span className="text-fg">{children}</span>
    </div>
  );
}
