import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import * as RadixToast from '@radix-ui/react-toast';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../cn';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastInput {
  readonly variant?: ToastVariant;
  readonly message: string;
  /** Milliseconds before auto-dismiss. Defaults to 5000 (errors get 8000 — worth more read time). */
  readonly duration?: number;
}

interface ToastItem extends Required<Omit<ToastInput, 'duration'>> {
  readonly id: string;
  readonly duration: number;
}

interface ToastContextValue {
  readonly toast: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  error: 'border-danger/30 bg-popover text-danger',
  success: 'border-success/30 bg-popover text-success',
  info: 'border-accent/30 bg-popover text-accent-hover',
};

const VARIANT_ICON: Record<ToastVariant, typeof AlertTriangle> = {
  error: AlertTriangle,
  success: CheckCircle2,
  info: Info,
};

const DEFAULT_DURATION_MS = 5000;
const ERROR_DURATION_MS = 8000;

/**
 * Real, transient, dismissible toasts for one-shot action results ("Pushed
 * to origin/main.", "Push failed: ..."). Built on Radix's Toast primitive
 * (same choice as Dialog/Select/Tabs elsewhere in this package) so the
 * live-region announcement, swipe-to-dismiss, and auto-hide-pause-on-hover
 * behavior is real, not hand-rolled. Distinct from InlineBanner, which is
 * for persistent state that stays visible until its cause resolves (an
 * empty state, "storage is starting up") — a toast fires once and goes
 * away; the caller doesn't have to clear it.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [items, setItems] = useState<readonly ToastItem[]>([]);

  const toast = useCallback((input: ToastInput) => {
    const variant = input.variant ?? 'info';
    const id = crypto.randomUUID();
    const duration = input.duration ?? (variant === 'error' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS);
    setItems((current) => [...current, { id, variant, message: input.message, duration }]);
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      <RadixToast.Provider swipeDirection="right">
        {children}
        {items.map((item) => {
          const Icon = VARIANT_ICON[item.variant];
          return (
            <RadixToast.Root
              key={item.id}
              duration={item.duration}
              onOpenChange={(open) => {
                if (!open) {
                  removeItem(item.id);
                }
              }}
              className={cn(
                'flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm shadow-2xl backdrop-blur-2xl',
                'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
                VARIANT_CLASSES[item.variant],
              )}
            >
              <Icon size={15} className="mt-0.5 shrink-0" />
              <RadixToast.Description className="flex-1 text-fg">{item.message}</RadixToast.Description>
              <RadixToast.Close aria-label="Dismiss" className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg">
                <X size={13} />
              </RadixToast.Close>
            </RadixToast.Root>
          );
        })}
        <RadixToast.Viewport className="fixed bottom-4 right-4 z-[100] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

/** Throws outside ToastProvider — same fail-fast convention as other context hooks in this codebase (no silent no-op fallback). */
export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return value;
}
