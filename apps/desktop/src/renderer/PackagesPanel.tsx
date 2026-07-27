import { useEffect, useRef, useState } from 'react';
import { Download, DownloadCloud, Package, RefreshCw, Trash2 } from 'lucide-react';
import type { PackageEntry, PackageSource } from '@space/contracts';
import { Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, EmptyState, Input, useToast } from '@space/ui';
import { BrandIcon, SERVICE_BRAND, TOOL_BRAND, brandForPackage } from './brand-icons';

const SEARCH_DEBOUNCE_MS = 350;

const SOURCE_LABEL: Record<PackageSource, string> = {
  'homebrew-formula': 'Homebrew',
  'homebrew-cask': 'App (Homebrew)',
  'npm-global': 'npm',
  winget: 'WinGet',
};

/** Best-effort brand icon for a package entry — its own real icon first, then a known-brand guess, then a generic glyph. Never a broken image. */
function PackageIcon({ entry }: { readonly entry: PackageEntry }) {
  if (entry.iconDataUrl) {
    return <img src={entry.iconDataUrl} alt="" className="h-6 w-6 shrink-0 rounded object-contain" />;
  }
  const brand = brandForPackage(entry.name) ?? TOOL_BRAND[entry.name] ?? SERVICE_BRAND[entry.name] ?? null;
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-surface-hover">
      {brand ? <BrandIcon icon={brand} size={14} /> : <Package size={14} className="text-fg-faint" />}
    </span>
  );
}

interface PackageRowProps {
  readonly entry: PackageEntry;
  readonly busy: boolean;
  readonly onInstall: () => void;
  readonly onUpdate: () => void;
  readonly onRequestUninstall: () => void;
  readonly hideUpdateAction: boolean;
}

/** One compact inventory row. Descriptions are available as the native title tooltip, not permanently consuming vertical space. */
function PackageTile({ entry, busy, onInstall, onUpdate, onRequestUninstall, hideUpdateAction }: PackageRowProps) {
  const installed = entry.installedVersion !== null;
  return (
    <div className="flex min-h-11 items-center gap-2 px-3 py-2" title={entry.description ?? undefined}>
      <PackageIcon entry={entry} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{entry.displayName}</p>
        <p className="text-[11px] text-fg-faint">{SOURCE_LABEL[entry.source]}</p>
      </div>
      <span className="shrink-0 text-xs text-fg-muted">
        {installed ? entry.installedVersion : 'Not installed'}
        {installed && entry.updateAvailable === true && entry.latestVersion && <span className="text-success"> → {entry.latestVersion}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {!installed ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onInstall}>
            {busy ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} />} Install
          </Button>
        ) : (
          <>
            {!hideUpdateAction && entry.updateAvailable === true && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onUpdate} aria-label={`Update ${entry.displayName}`}>
                {busy ? <RefreshCw size={12} className="animate-spin" /> : <DownloadCloud size={12} />} Update
              </Button>
            )}
            <button type="button" className="rounded p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50" disabled={busy} onClick={onRequestUninstall} aria-label={`Remove ${entry.displayName}`} title={`Remove ${entry.displayName}`}>
              {busy ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          </>
        )}
      </span>
    </div>
  );
}

export function PackagesPanel({ hideUpdateActions = false }: { readonly hideUpdateActions?: boolean }) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [installed, setInstalled] = useState<readonly PackageEntry[] | null>(null);
  const [searchResults, setSearchResults] = useState<readonly PackageEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [inFlightIds, setInFlightIds] = useState<ReadonlySet<string>>(new Set());
  const [pendingRemoval, setPendingRemoval] = useState<PackageEntry | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  async function refreshInstalled(): Promise<void> {
    setLoading(true);
    try {
      const result = await window.space.packages.listInstalled();
      setInstalled(result.packages);
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshInstalled();
    // Fetch the real installed inventory once on mount; searches and actions refresh it explicitly afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPackagesChanged = () => void refreshCurrent();
    window.addEventListener('space:packages-changed', onPackagesChanged);
    return () => window.removeEventListener('space:packages-changed', onPackagesChanged);
    // refreshCurrent is declared below and intentionally reads the current query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  useEffect(() => {
    if (debouncedQuery === '') {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    window.space.packages
      .search({ query: debouncedQuery })
      .then((result) => {
        if (!cancelled) {
          setSearchResults(result.packages);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, toast]);

  const isSearching = debouncedQuery !== '';
  const list = isSearching ? searchResults : installed;

  async function refreshCurrent(): Promise<void> {
    if (isSearching) {
      try {
        const result = await window.space.packages.search({ query: debouncedQuery });
        setSearchResults(result.packages);
      } catch (caught) {
        toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
      }
    } else {
      await refreshInstalled();
    }
  }

  async function runAction(entry: PackageEntry, action: 'install' | 'update' | 'uninstall'): Promise<void> {
    if (inFlightIds.has(entry.id)) {
      return;
    }
    setInFlightIds((prev) => new Set(prev).add(entry.id));
    const activityId = `package:${entry.id}:${Date.now()}`;
    const activityLabel = `${action === 'update' ? 'Updating' : action === 'install' ? 'Installing' : 'Removing'} ${entry.displayName}`;
    if (action === 'update' || action === 'install') {
      window.dispatchEvent(new CustomEvent('space:installation-activity', { detail: { id: activityId, label: activityLabel, state: 'running' } }));
    }
    try {
      const input = { source: entry.source, name: entry.name };
      const result = action === 'install'
        ? await window.space.packages.install(input)
        : action === 'update'
          ? await window.space.packages.update(input)
          : await window.space.packages.uninstall(input);
      if (!result.succeeded) {
        throw new Error(result.message ?? `${action} failed for ${entry.displayName}.`);
      }
      if (action === 'update' || action === 'install') {
        window.dispatchEvent(new CustomEvent('space:installation-activity', { detail: { id: activityId, label: activityLabel, state: 'completed' } }));
      }
      await refreshCurrent();
    } catch (caught) {
      if (action === 'update' || action === 'install') {
        window.dispatchEvent(
          new CustomEvent('space:installation-activity', {
            detail: { id: activityId, label: activityLabel, state: 'failed', message: caught instanceof Error ? caught.message : String(caught) },
          }),
        );
      }
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setInFlightIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="gap-4">
        <CardTitle className="shrink-0">Packages</CardTitle>
        <Input
          className="ml-auto max-w-sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search for any package or app…"
          aria-label="Search packages"
        />
      </CardHeader>

      {loading && list === null ? (
        <CardContent>
          <p className="text-sm text-fg-faint">Loading…</p>
        </CardContent>
      ) : list === null || list.length === 0 ? (
        <CardContent>
          <EmptyState
            icon={<Package size={20} />}
            title={isSearching ? `No packages found for "${debouncedQuery}".` : 'Nothing installed yet.'}
            {...(isSearching ? { description: 'Try a different name — Homebrew formulas, casks, and npm packages are all searched together.' } : {})}
          />
        </CardContent>
      ) : (
        <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {list.map((entry) => (
            <PackageTile
              key={entry.id}
              entry={entry}
              busy={inFlightIds.has(entry.id)}
              onInstall={() => void runAction(entry, 'install')}
              onUpdate={() => void runAction(entry, 'update')}
              onRequestUninstall={() => setPendingRemoval(entry)}
              hideUpdateAction={hideUpdateActions}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRemoval(null);
          }
        }}
        title={pendingRemoval ? `Remove ${pendingRemoval.displayName}?` : 'Remove package?'}
        description="This uninstalls it from your machine. You can always reinstall it later."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (pendingRemoval) {
            void runAction(pendingRemoval, 'uninstall');
          }
        }}
      />
    </Card>
  );
}
