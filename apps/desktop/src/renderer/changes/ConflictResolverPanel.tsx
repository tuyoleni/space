import { FileWarning } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn } from '@space/ui';
import { DiffPreview } from './DiffPreview';

export interface ConflictResolverPanelProps {
  readonly conflictedFiles: readonly string[];
  readonly selectedFile: string | null;
  readonly onSelectFile: (path: string) => void;
  readonly patchText: string | null;
  readonly onUseOurs: () => void;
  readonly onUseTheirs: () => void;
  readonly onStageResolved: () => void;
  readonly onContinue: () => void;
  readonly onAbort: () => void;
  readonly busy: boolean;
}

/**
 * The right-hand merge-conflict resolver. Lists the conflicted paths, shows
 * the selected file's conflict diff via the shared {@link DiffPreview}, and
 * exposes the resolution actions (use ours / use theirs, stage resolved,
 * continue, abort). Pure controlled surface — every action is a prop callback
 * and `busy` disables them during an in-flight git operation.
 */
export function ConflictResolverPanel({
  conflictedFiles,
  selectedFile,
  onSelectFile,
  patchText,
  onUseOurs,
  onUseTheirs,
  onStageResolved,
  onContinue,
  onAbort,
  busy,
}: ConflictResolverPanelProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            <FileWarning size={14} className="text-danger" />
            Conflict resolver
          </span>
        </CardTitle>
        <Badge variant="danger">{conflictedFiles.length} conflict{conflictedFiles.length === 1 ? '' : 's'}</Badge>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4 pt-4">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-faint">Conflicted files</p>
          {conflictedFiles.length === 0 ? (
            <p className="text-xs text-fg-faint">No conflicts — the working tree is clean.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {conflictedFiles.map((path) => {
                const selected = path === selectedFile;
                return (
                  <li key={path}>
                    <button
                      type="button"
                      onClick={() => onSelectFile(path)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-surface-hover',
                        selected && 'bg-surface-hover',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-fg">
                        <FileWarning size={12} className="shrink-0 text-danger" />
                        <span className="truncate">{path}</span>
                      </span>
                      <Badge variant="danger">CONFLICT</Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectedFile && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-faint">Conflict diff — {selectedFile}</p>
            {patchText === null ? (
              <p className="text-xs text-fg-faint">Loading diff…</p>
            ) : patchText.trim() === '' ? (
              <p className="text-xs text-fg-faint">No textual conflict to display.</p>
            ) : (
              <DiffPreview patchText={patchText} />
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={onUseOurs} disabled={busy}>
                Use ours
              </Button>
              <Button size="sm" variant="secondary" onClick={onUseTheirs} disabled={busy}>
                Use theirs
              </Button>
              <Button size="sm" variant="ghost" disabled title="Opening an external merge tool isn't available yet">
                Open merge tool
              </Button>
              <Button size="sm" variant="primary" onClick={onStageResolved} disabled={busy}>
                Stage resolved
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border px-3.5 py-2.5">
        <Button size="sm" variant="danger" onClick={onAbort} disabled={busy}>
          Abort
        </Button>
        <Button size="sm" variant="primary" onClick={onContinue} disabled={busy || conflictedFiles.length > 0}>
          Continue
        </Button>
      </div>
    </Card>
  );
}
