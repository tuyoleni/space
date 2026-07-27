import { useEffect, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, DownloadCloud, Loader2, TriangleAlert } from 'lucide-react';
import type { PackageEntry } from '@space/contracts';
import { Button } from '@space/ui';

type ActivityState = 'queued' | 'running' | 'completed' | 'failed';

interface UpdateActivity {
  readonly id: string;
  readonly label: string;
  readonly state: ActivityState;
  readonly message: string | null;
  readonly entry?: PackageEntry;
}

/** The single update control for the Environment screen. Progress is per real command result, never a made-up percentage. */
export function PackageUpdatesMenu() {
  const [available, setAvailable] = useState<readonly PackageEntry[]>([]);
  const [activity, setActivity] = useState<readonly UpdateActivity[]>([]);

  async function refreshAvailable(): Promise<void> {
    const result = await window.space.packages.listInstalled().catch(() => null);
    setAvailable((result?.packages ?? []).filter((entry) => entry.installedVersion !== null && entry.updateAvailable === true));
  }

  useEffect(() => {
    void refreshAvailable();
  }, []);

  useEffect(() => {
    const onExternalInstall = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly id: string; readonly label: string; readonly state?: ActivityState; readonly message?: string | null }>).detail;
      if (!detail?.id || !detail.label) {
        return;
      }
      setActivity((items) => {
        const existing = items.find((item) => item.id === detail.id);
        const next = { id: detail.id, label: detail.label, state: detail.state ?? 'running', message: detail.message ?? null };
        return existing ? items.map((item) => (item.id === detail.id ? { ...item, ...next } : item)) : [...items, next];
      });
    };
    window.addEventListener('space:installation-activity', onExternalInstall);
    return () => window.removeEventListener('space:installation-activity', onExternalInstall);
  }, []);

  const activeCount = activity.filter((item) => item.state === 'queued' || item.state === 'running').length;
  const rows = activity.length > 0 ? activity : available.map((entry) => ({ id: entry.id, label: entry.displayName, entry, state: 'queued' as const, message: null }));

  async function updateAll(): Promise<void> {
    if (activeCount > 0 || available.length === 0) {
      return;
    }
    const initial = available.map((entry) => ({ id: entry.id, label: entry.displayName, entry, state: 'queued' as const, message: null }));
    setActivity((items) => [...items.filter((item) => !item.entry), ...initial]);
    for (const item of initial) {
      const entry = item.entry;
      if (!entry) {
        continue;
      }
      setActivity((items) => items.map((candidate) => (candidate.id === item.id ? { ...candidate, state: 'running' } : candidate)));
      const result = await window.space.packages.update({ source: entry.source, name: entry.name }).catch((error: unknown) => ({
        succeeded: false,
        message: error instanceof Error ? error.message : String(error),
      }));
      setActivity((items) =>
        items.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, state: result.succeeded ? 'completed' : 'failed', message: result.message ?? null }
            : candidate,
        ),
      );
    }
    await refreshAvailable();
    window.dispatchEvent(new Event('space:packages-changed'));
  }

  return (
    // Non-modal — see Sidebar.tsx: a modal menu whose item starts an async
    // action leaks `pointer-events: none` onto <body> and freezes input.
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button size="sm" variant="secondary" disabled={rows.length === 0}>
          {activeCount > 0 ? <Loader2 size={13} className="animate-spin" /> : <DownloadCloud size={13} />}
          {activeCount > 0 ? `Updating ${activeCount}/${activity.length}` : `${available.length} updates`}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-80 rounded-lg border border-border bg-popover p-2 shadow-xl">
          <div className="flex items-center justify-between gap-3 px-2 py-1.5">
            <span className="text-sm font-medium text-fg">Updates</span>
            {activeCount === 0 && available.length > 0 && <Button size="sm" variant="primary" onClick={() => void updateAll()}>Update all</Button>}
          </div>
          <div className="max-h-72 divide-y divide-border overflow-y-auto">
            {rows.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 px-2 py-2 text-sm">
                <span className="min-w-0 truncate text-fg">{item.label}</span>
                <span className={item.state === 'failed' ? 'flex shrink-0 items-center gap-1 text-xs text-danger' : item.state === 'completed' ? 'flex shrink-0 items-center gap-1 text-xs text-success' : item.state === 'running' ? 'flex shrink-0 items-center gap-1 text-xs text-accent' : 'shrink-0 text-xs text-fg-muted'} title={item.message ?? undefined}>
                  {item.state === 'running' && <Loader2 size={12} className="animate-spin" />}
                  {item.state === 'completed' && <Check size={12} />}
                  {item.state === 'failed' && <TriangleAlert size={12} />}
                  {item.state === 'queued' ? 'Ready' : item.state === 'running' ? 'Installing…' : item.state === 'completed' ? 'Done' : 'Failed'}
                </span>
              </div>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
