import { FileDiff } from 'lucide-react';
import { Badge, cn } from '@space/ui';

export interface FileDiffRow {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly staged: boolean;
}

export interface FileExplorerListProps {
  readonly files: readonly FileDiffRow[];
  readonly selectedPath: string | null;
  readonly onSelect: (path: string) => void;
}

/**
 * A flat file list built from diff stats — the same selectable file-row look
 * used in ChangesView's "Changed files" list (file-diff glyph, truncated
 * path, +added/−removed, selection highlight). Adds a small "Staged" badge so
 * the File Explorer tab can show index state at a glance.
 */
export function FileExplorerList({ files, selectedPath, onSelect }: FileExplorerListProps) {
  return (
    <ul className="flex flex-col gap-0.5">
      {files.map((file) => {
        const selected = file.path === selectedPath;
        return (
          <li key={file.path}>
            <button
              type="button"
              onClick={() => onSelect(file.path)}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-surface-hover',
                selected && 'bg-surface-hover',
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-fg">
                <FileDiff size={12} className="shrink-0 text-fg-muted" />
                <span className="truncate">{file.path}</span>
                {file.staged && <Badge variant="success">Staged</Badge>}
              </span>
              <span className="shrink-0 text-xs">
                <span className="text-success">+{file.added}</span> <span className="text-danger">−{file.removed}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
