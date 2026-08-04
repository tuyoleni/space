/**
 * Notification center: a bell icon in the status bar with a dropdown panel
 * showing persistent, actionable notifications. Unlike Toast (ephemeral,
 * one-shot), notifications are stored in memory, have read/unread state,
 * and can be actioned (open project, retry operation, etc.).
 *
 * Notifications are pushed via the `useNotificationCenter` hook and
 * displayed in a floating panel anchored to the status bar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellDot,
  X,
  Trash2,
  CheckCheck,
  GitBranch,
  GitPullRequest,
  Terminal,
  FolderOpen,
  Zap,
} from 'lucide-react';
import { cn } from '@space/ui';

export type NotificationVariant = 'success' | 'error' | 'info' | 'warning';
export type NotificationCategory = 'git' | 'github' | 'terminal' | 'project' | 'system';

export interface Notification {
  readonly id: string;
  readonly variant: NotificationVariant;
  readonly category: NotificationCategory;
  readonly title: string;
  readonly message: string;
  readonly timestamp: Date;
  readonly read: boolean;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

interface NotificationCenterProps {
  readonly notifications: readonly Notification[];
  readonly unreadCount: number;
  readonly onMarkAllRead: () => void;
  readonly onClearAll: () => void;
  readonly onDismiss: (id: string) => void;
}

const VARIANT_STYLES: Record<NotificationVariant, string> = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-accent',
  warning: 'text-warning',
};

const CATEGORY_ICONS: Record<NotificationCategory, typeof Bell> = {
  git: GitBranch,
  github: GitPullRequest,
  terminal: Terminal,
  project: FolderOpen,
  system: Zap,
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function NotificationCenter({
  notifications,
  unreadCount,
  onMarkAllRead,
  onClearAll,
  onDismiss,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const panelRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (filter === 'unread') return notifications.filter((n) => !n.read);
    return notifications;
  }, [notifications, filter]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'relative rounded-md p-1.5 transition-colors',
          'text-fg-muted hover:bg-surface-hover hover:text-fg',
          open && 'bg-surface-hover text-fg',
        )}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        {unreadCount > 0 ? <BellDot size={15} /> : <Bell size={15} />}
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-[150] mb-2 w-80 rounded-lg border border-border bg-popover shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-fg">Notifications</h3>
              {unreadCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent/20 px-1 text-[9px] font-bold text-accent">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className="rounded p-1 text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg"
                  title="Mark all as read"
                >
                  <CheckCheck size={13} />
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={onClearAll}
                  className="rounded p-1 text-fg-faint transition-colors hover:bg-surface-hover hover:text-danger"
                  title="Clear all"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex border-b border-border px-3 pt-1">
            {(['all', 'unread'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={cn(
                  'px-2 py-1.5 text-[11px] font-medium capitalize transition-colors',
                  filter === tab ? 'border-b-2 border-accent text-accent' : 'text-fg-muted hover:text-fg',
                )}
              >
                {tab}
                {tab === 'unread' && unreadCount > 0 && (
                  <span className="ml-1 text-fg-faint">({unreadCount})</span>
                )}
              </button>
            ))}
          </div>

          {/* Notification list */}
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell size={24} className="mx-auto mb-2 text-fg-faint" />
                <p className="text-xs text-fg-muted">
                  {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
                </p>
              </div>
            ) : (
              filtered.map((notification) => {
                const CategoryIcon = CATEGORY_ICONS[notification.category];
                return (
                  <div
                    key={notification.id}
                    className={cn(
                      'group flex items-start gap-2.5 border-b border-border/50 px-3 py-2.5 transition-colors last:border-b-0',
                      !notification.read && 'bg-accent/5',
                    )}
                  >
                    <div className={cn('mt-0.5 shrink-0', VARIANT_STYLES[notification.variant])}>
                      <CategoryIcon size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn('text-xs font-medium', !notification.read ? 'text-fg' : 'text-fg-muted')}>
                          {notification.title}
                        </p>
                        <button
                          type="button"
                          onClick={() => onDismiss(notification.id)}
                          className="shrink-0 rounded p-0.5 text-fg-faint opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
                          aria-label="Dismiss"
                        >
                          <X size={11} />
                        </button>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-tight text-fg-faint">{notification.message}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10px] text-fg-faint">{formatRelativeTime(notification.timestamp)}</span>
                        {notification.actionLabel && notification.onAction && (
                          <button
                            type="button"
                            onClick={() => notification.onAction?.()}
                            className="text-[10px] font-medium text-accent hover:text-accent-hover"
                          >
                            {notification.actionLabel}
                          </button>
                        )}
                      </div>
                    </div>
                    {!notification.read && (
                      <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** In-memory notification store. Returns the notification list and helpers. */
export function useNotificationCenter() {
  const [notifications, setNotifications] = useState<readonly Notification[]>([]);
  const idCounter = useRef(0);

  const addNotification = useCallback(
    (input: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
      const notification: Notification = {
        ...input,
        id: `notif-${++idCounter.current}`,
        timestamp: new Date(),
        read: false,
      };
      setNotifications((prev) => [notification, ...prev].slice(0, 50)); // cap at 50
      return notification.id;
    },
    [],
  );

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  return {
    notifications,
    unreadCount,
    addNotification,
    markAllRead,
    markRead,
    dismiss,
    clearAll,
  };
}
