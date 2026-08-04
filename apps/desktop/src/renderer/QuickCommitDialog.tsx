/**
 * Quick Commit Dialog: opens with Cmd+Enter to quickly commit staged changes.
 * Pre-fills with a conventional commit template based on changed files.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { GitCommitHorizontal } from 'lucide-react';
import { Button, Dialog, Input } from '@space/ui';
import type { GitStatusSummary } from '@space/contracts';

interface QuickCommitDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly gitStatus: GitStatusSummary | null;
  readonly onCommit: (message: string) => void;
}

function inferCommitType(gitStatus: GitStatusSummary | null): string {
  if (!gitStatus) return 'chore';
  const staged = gitStatus.entries.filter((e) => 'indexStatus' in e && e.indexStatus !== '.');
  const added = staged.filter((e) => 'indexStatus' in e && e.indexStatus === 'A').length;
  const modified = staged.filter((e) => 'indexStatus' in e && e.indexStatus === 'M').length;
  const deleted = staged.filter((e) => 'indexStatus' in e && e.indexStatus === 'D').length;
  if (added > 0 && modified === 0 && deleted === 0) return 'feat';
  if (deleted > 0 && added === 0 && modified === 0) return 'refactor';
  if (gitStatus.conflictedFiles.length > 0) return 'fix';
  return 'chore';
}

function inferScope(files: readonly string[]): string | null {
  if (files.length === 0) return null;
  const first = files[0] ?? '';
  // Try to infer scope from path: src/components/Foo.tsx -> components
  const parts = first.split('/');
  if (parts.length >= 3) return parts[1] ?? null;
  return null;
}

export function QuickCommitDialog({ open, onOpenChange, gitStatus, onCommit }: QuickCommitDialogProps) {
  const [type, setType] = useState('chore');
  const [scope, setScope] = useState('');
  const [message, setMessage] = useState('');
  const [breaking, setBreaking] = useState(false);

  const stagedFiles = useMemo(() => {
    if (!gitStatus) return [];
    return gitStatus.entries.filter((e) => 'indexStatus' in e && e.indexStatus !== '.').map((e) => e.path);
  }, [gitStatus]);

  useEffect(() => {
    if (open) {
      setType(inferCommitType(gitStatus));
      const inferred = inferScope(stagedFiles);
      setScope(inferred ?? '');
      setMessage('');
      setBreaking(false);
    }
  }, [open, gitStatus, stagedFiles]);

  const commitMessage = useMemo(() => {
    const scopePart = scope ? `(${scope})` : '';
    const breakingMark = breaking ? '!' : '';
    if (!message) return `${type}${scopePart}${breakingMark}: `;
    return `${type}${scopePart}${breakingMark}: ${message}`;
  }, [type, scope, message, breaking]);

  const handleSubmit = useCallback(() => {
    if (!commitMessage.trim()) return;
    onCommit(commitMessage.trim());
    onOpenChange(false);
  }, [commitMessage, onCommit, onOpenChange]);

  const COMMIT_TYPES = [
    { value: 'feat', label: 'feat', description: 'New feature' },
    { value: 'fix', label: 'fix', description: 'Bug fix' },
    { value: 'refactor', label: 'refactor', description: 'Code refactor' },
    { value: 'chore', label: 'chore', description: 'Maintenance' },
    { value: 'docs', label: 'docs', description: 'Documentation' },
    { value: 'test', label: 'test', description: 'Tests' },
    { value: 'style', label: 'style', description: 'Formatting' },
    { value: 'perf', label: 'perf', description: 'Performance' },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Quick Commit"
      description={`${stagedFiles.length} staged file${stagedFiles.length === 1 ? '' : 's'}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!message.trim()}
            onClick={handleSubmit}
          >
            <GitCommitHorizontal size={13} className="mr-1" />
            Commit
          </Button>
        </>
      }
    >
      {/* Type selector */}
      <div className="mb-3">
        <label className="mb-1 block text-[11px] font-medium text-fg-muted">Type</label>
        <div className="flex flex-wrap gap-1">
          {COMMIT_TYPES.map((ct) => (
            <button
              key={ct.value}
              type="button"
              onClick={() => setType(ct.value)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-mono font-medium transition-colors ${
                type === ct.value
                  ? 'bg-accent text-white'
                  : 'bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg'
              }`}
              title={ct.description}
            >
              {ct.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scope */}
      <div className="mb-3">
        <label className="mb-1 block text-[11px] font-medium text-fg-muted">Scope (optional)</label>
        <Input
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          placeholder="e.g. components, auth, terminal"
          className="h-7 text-xs"
        />
      </div>

      {/* Breaking change toggle */}
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setBreaking(!breaking)}
          className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
            breaking ? 'bg-danger text-white' : 'bg-surface text-fg-muted hover:bg-surface-hover'
          }`}
        >
          Breaking Change
        </button>
        {breaking && <span className="text-[10px] text-danger">Adds ! to commit type</span>}
      </div>

      {/* Message */}
      <div className="mb-2">
        <label className="mb-1 block text-[11px] font-medium text-fg-muted">Message</label>
        <Input
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What changed?"
          className="h-7 text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
          }}
        />
      </div>

      {/* Preview */}
      <div className="rounded-md bg-surface p-2 font-mono text-[11px] text-fg-muted">
        <span className="text-fg-faint">Preview: </span>
        <span className="text-fg">{commitMessage || 'feat: '}</span>
      </div>

      {/* Staged files list */}
      {stagedFiles.length > 0 && (
        <div className="mt-3 max-h-32 overflow-y-auto rounded-md bg-surface p-2">
          {stagedFiles.map((f) => (
            <div key={f} className="truncate py-0.5 font-mono text-[10px] text-fg-muted">{f}</div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
