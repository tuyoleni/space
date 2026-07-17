import { useEffect, useState } from 'react';
import { FolderKanban } from 'lucide-react';
import { identityColor } from '@space/ui';

/**
 * A project's real shipped icon (favicon/app icon, resolved by the main
 * process from the project's own files) with a generated identity-colored
 * tile as the fallback when the project ships no icon. Results are cached
 * per path across the session so switching views doesn't re-read the disk.
 */
const iconCache = new Map<string, string | null>();

export function ProjectIcon({ projectId, canonicalPath, size = 28 }: { readonly projectId: string; readonly canonicalPath: string; readonly size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null | undefined>(() => iconCache.get(canonicalPath));

  useEffect(() => {
    if (iconCache.has(canonicalPath)) {
      setDataUrl(iconCache.get(canonicalPath));
      return;
    }
    let cancelled = false;
    void window.space.project.icon({ canonicalPath }).then((result) => {
      const value = result?.dataUrl ?? null;
      iconCache.set(canonicalPath, value);
      if (!cancelled) {
        setDataUrl(value);
      }
    }, () => undefined);
    return () => {
      cancelled = true;
    };
  }, [canonicalPath]);

  const dimension = { width: size, height: size };

  if (dataUrl) {
    return <img src={dataUrl} alt="" className="shrink-0 rounded-md object-cover" style={dimension} />;
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-md"
      style={{ ...dimension, backgroundColor: identityColor(projectId) }}
    >
      <FolderKanban size={Math.round(size * 0.55)} className="text-white" />
    </span>
  );
}
