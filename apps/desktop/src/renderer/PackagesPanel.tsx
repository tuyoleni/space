import { useEffect, useRef, useState } from 'react';
import { Download, DownloadCloud, Package, RefreshCw, Trash2 } from 'lucide-react';
import type { PackageEntry, PackageSource } from '@space/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, EmptyState, Input, useToast } from '@space/ui';
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
    return <img src={entry.iconDataUrl} alt="" className="h-8 w-8 shrink-0 rounded-md object-contain" />;
  }
  const brand = brandForPackage(entry.name) ?? TOOL_BRAND[entry.name] ?? SERVICE_BRAND[entry.name] ?? null;
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-hover">
      {brand ? <BrandIcon icon={brand} size={16} /> : <Package size={16} className="text-fg-faint" />}
    </span>
  );
}

interface PackageRowProps {
  readonly entry: PackageEntry;
  readonly busy: boolean;
  readonly onInstall: () => void;
  readonly onUpdate: () => void;
  readonly onRequestUninstall: () => void;
}

/** One tile in the package grid — a compact, self-contained card, not a full-width list row. */
function PackageTile({ entry, busy, onInstall, onUpdate, onRequestUninstall }: PackageRowProps) {
  const installed = entry.installedVersion !== null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-start gap-2.5">
        <PackageIcon entry={entry} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">{entry.displayName}</p>
          <Badge variant="neutral">{SOURCE_LABEL[entry.source]}</Badge>
        </div>
      </div>

      {entry.description && <p className="line-clamp-2 text-xs text-fg-muted">{entry.description}</p>}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="min-w-0 truncate text-xs text-fg-muted">
          {installed ? (
            <>
              {entry.installedVersion}
              {entry.updateAvailable === true && entry.latestVersion && (
                <>
                  {' '}
                  <span className="text-fg-faint">→</span> <span className="text-success">{entry.latestVersion}</span>
                </>
              )}
            </>
          ) : (
            '—'
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {!installed ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onInstall}>
              {busy ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} />} Install
            </Button>
          ) : (
            <>
              {entry.updateAvailable === true && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={onUpdate}>
                  {busy ? <RefreshCw size={12} className="animate-spin" /> : <DownloadCloud size={12} />} Update
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={busy} onClick={onRequestUninstall} aria-label={`Remove ${entry.displayName}`}>
                {busy ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
              </Button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

export function PackagesPanel() {
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
  }, [debouncedQuery]);

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
    try {
      const input = { source: entry.source, name: entry.name };
      if (action === 'install') {
        await window.space.packages.install(input);
      } else if (action === 'update') {
        await window.space.packages.update(input);
      } else {
        await window.space.packages.uninstall(input);
      }
      await refreshCurrent();
    } catch (caught) {
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
      <CardHeader>
        <div>
          <CardTitle>Packages</CardTitle>
          <p className="mt-0.5 text-xs text-fg-muted">Search, install, and manage everything on this machine — Homebrew, npm, and WinGet in one place.</p>
        </div>
      </CardHeader>
      <CardContent>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search for any package or app…"
          aria-label="Search packages"
        />
      </CardContent>

      {loading && list === null ? (
        <CardContent className="pt-0">
          <p className="text-sm text-fg-faint">Loading…</p>
        </CardContent>
      ) : list === null || list.length === 0 ? (
        <CardContent className="pt-0">
          <EmptyState
            icon={<Package size={20} />}
            title={isSearching ? `No packages found for "${debouncedQuery}".` : 'Nothing installed yet.'}
            {...(isSearching ? { description: 'Try a different name — Homebrew formulas, casks, and npm packages are all searched together.' } : {})}
          />
        </CardContent>
      ) : (
        <CardContent className="min-h-0 flex-1 overflow-y-auto pt-0">
          <div className="grid grid-cols-1 gap-2">
            {list.map((entry) => (
              <PackageTile
                key={entry.id}
                entry={entry}
                busy={inFlightIds.has(entry.id)}
                onInstall={() => void runAction(entry, 'install')}
                onUpdate={() => void runAction(entry, 'update')}
                onRequestUninstall={() => setPendingRemoval(entry)}
              />
            ))}
          </div>
        </CardContent>
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
