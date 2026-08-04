/**
 * Branch Dialog: create a new git branch from the current state.
 * Opens from the Command Palette or topbar BranchMenu.
 */
import { useState, useMemo, useCallback } from 'react';
import { GitBranch, ArrowRight } from 'lucide-react';
import { Button, Dialog, Input } from '@space/ui';
import type { GitStatusSummary } from '@space/contracts';

interface BranchDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly gitStatus: GitStatusSummary | null;
  readonly onCreateBranch: (name: string) => void;
}

function sanitizeBranchName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function BranchDialog({ open, onOpenChange, gitStatus, onCreateBranch }: BranchDialogProps) {
  const [name, setName] = useState('');

  const currentBranch = gitStatus?.branch.branchName ?? 'main';
  const sanitizedName = useMemo(() => sanitizeBranchName(name), [name]);

  const handleSubmit = useCallback(() => {
    if (!sanitizedName.trim()) return;
    onCreateBranch(sanitizedName.trim());
    setName('');
    onOpenChange(false);
  }, [sanitizedName, onCreateBranch, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create Branch"
      description={`Branching from ${currentBranch}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!sanitizedName.trim()}
            onClick={handleSubmit}
          >
            <GitBranch size={13} className="mr-1" />
            Create Branch
          </Button>
        </>
      }
    >
      {/* Current branch */}
      <div className="mb-3 flex items-center gap-2 rounded-md bg-surface p-2">
        <span className="text-[10px] text-fg-faint">From:</span>
        <span className="font-mono text-xs text-fg">{currentBranch}</span>
      </div>

      {/* New branch name */}
      <div className="mb-3">
        <label className="mb-1 block text-[11px] font-medium text-fg-muted">Branch name</label>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. feature/my-new-thing"
          className="h-7 text-xs font-mono"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
          }}
        />
      </div>

      {/* Preview */}
      {name && (
        <div className="flex items-center gap-2 rounded-md bg-surface p-2 text-[11px]">
          <span className="text-fg-faint">Preview:</span>
          <span className="font-mono text-fg-muted">{currentBranch}</span>
          <ArrowRight size={10} className="text-fg-faint" />
          <span className="font-mono font-medium text-accent">{sanitizedName}</span>
        </div>
      )}

      {/* Tips */}
      <div className="mt-3 rounded-md bg-accent/5 p-2 text-[10px] text-fg-muted">
        <p>Branch names are automatically sanitized: lowercased, spaces become hyphens, special characters removed.</p>
        <p className="mt-1">Use <code className="rounded bg-surface px-1 text-accent">/</code> for directory-style names (e.g. <code className="rounded bg-surface px-1 text-accent">feature/auth</code>).</p>
      </div>
    </Dialog>
  );
}
