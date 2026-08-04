/**
 * Git Diff Viewer: renders inline diffs for modified files.
 * Shows a list of changed files on the left, and a unified diff on the right.
 * Supports staged/unstaged toggle, expand/collapse hunks.
 */
import { useMemo, useState } from 'react';
import {
  FileText,
  ChevronRight,
  ChevronDown,
  Diff,
  Check,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@space/ui';

export interface DiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly content: string;
}

export interface FileDiff {
  readonly path: string;
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  readonly hunks: readonly DiffHunk[];
  readonly additions: number;
  readonly deletions: number;
}

interface GitDiffViewerProps {
  readonly files: readonly FileDiff[];
  readonly onStage?: (path: string) => void;
  readonly onUnstage?: (path: string) => void;
  readonly stagedPaths?: ReadonlySet<string>;
}

function statusLabel(status: FileDiff['status']): string {
  switch (status) {
    case 'added': return 'A';
    case 'modified': return 'M';
    case 'deleted': return 'D';
    case 'renamed': return 'R';
    case 'copied': return 'C';
  }
}

function statusColor(status: FileDiff['status']): string {
  switch (status) {
    case 'added': return 'text-success';
    case 'modified': return 'text-warning';
    case 'deleted': return 'text-danger';
    case 'renamed': return 'text-accent';
    case 'copied': return 'text-fg-muted';
  }
}

function DiffLine({ line, lineNum, oldNum }: { line: string; lineNum?: number; oldNum?: number }) {
  const trimmed = line.replace(/^[-+ ]/, '');
  const prefix = line.charAt(0);
  return (
    <div className={cn(
      'flex font-mono text-[11px] leading-5',
      prefix === '+' && 'bg-success/10 text-success',
      prefix === '-' && 'bg-danger/10 text-danger',
      prefix === ' ' && 'text-fg-muted',
    )}>
      <span className="w-10 shrink-0 select-none text-right pr-1 text-fg-faint">{oldNum ?? ''}</span>
      <span className="w-10 shrink-0 select-none text-right pr-1 text-fg-faint">{lineNum ?? ''}</span>
      <span className="shrink-0 w-5 text-center text-fg-faint">{prefix === '+' ? '+' : prefix === '-' ? '-' : ' '}</span>
      <span className="flex-1 whitespace-pre">{trimmed}</span>
    </div>
  );
}

function HunkView({ hunk }: { hunk: DiffHunk }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border-b border-border/30">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1 bg-surface/50 px-2 py-0.5 text-[10px] font-medium text-fg-muted hover:bg-surface-hover"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span>@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
      </button>
      {expanded && (
        <div>
          {hunk.content.split('\n').map((line, i) => (
            <DiffLine key={i} line={line} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileDiffCard({ file, staged, onToggleStage }: {
  file: FileDiff;
  staged: boolean;
  onToggleStage?: (() => void) | undefined;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border/30 last:border-b-0">
      <div className={cn(
        'group flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover',
        staged && 'bg-accent/5',
      )}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 text-fg-faint"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <FileText size={12} className={cn('shrink-0', statusColor(file.status))} />
        <span className="flex-1 truncate font-mono text-xs text-fg">{file.path}</span>
        <span className={cn('shrink-0 text-[10px] font-bold', statusColor(file.status))}>{statusLabel(file.status)}</span>
        <span className="shrink-0 text-[10px] text-success">+{file.additions}</span>
        <span className="shrink-0 text-[10px] text-danger">-{file.deletions}</span>
        {onToggleStage && (
          <button
            type="button"
            onClick={onToggleStage}
            className={cn(
              'shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100',
              staged ? 'text-accent hover:text-danger' : 'text-fg-faint hover:text-success',
            )}
            title={staged ? 'Unstage' : 'Stage'}
          >
            {staged ? <RotateCcw size={11} /> : <Check size={11} />}
          </button>
        )}
      </div>
      {expanded && file.hunks.map((hunk, i) => (
        <HunkView key={i} hunk={hunk} />
      ))}
    </div>
  );
}

export function GitDiffViewer({ files, onStage, onUnstage, stagedPaths }: GitDiffViewerProps) {
  const [mode, setMode] = useState<'staged' | 'unstaged'>('unstaged');

  const { stagedFiles, unstagedFiles } = useMemo(() => {
    const staged: FileDiff[] = [];
    const unstaged: FileDiff[] = [];
    for (const file of files) {
      if (stagedPaths?.has(file.path)) {
        staged.push(file);
      } else {
        unstaged.push(file);
      }
    }
    return { stagedFiles: staged, unstagedFiles: unstaged };
  }, [files, stagedPaths]);

  const activeFiles = mode === 'staged' ? stagedFiles : unstagedFiles;

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Diff size={32} className="mb-3 text-fg-faint" />
        <p className="text-sm font-medium text-fg-muted">No changes</p>
        <p className="mt-1 text-xs text-fg-faint">Edit files in your project to see diffs here.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with staged/unstaged toggle */}
      <div className="flex items-center gap-1 border-b border-border px-3 pt-1">
        {(['unstaged', 'staged'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMode(tab)}
            className={cn(
              'flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium capitalize transition-colors',
              mode === tab ? 'border-b-2 border-accent text-accent' : 'text-fg-muted hover:text-fg',
            )}
          >
            {tab}
            <span className="text-fg-faint">({tab === 'staged' ? stagedFiles.length : unstagedFiles.length})</span>
          </button>
        ))}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {activeFiles.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-fg-muted">
            No {mode} changes
          </div>
        ) : (
          activeFiles.map((file) => (
            <FileDiffCard
              key={file.path}
              file={file}
              staged={stagedPaths?.has(file.path) ?? false}
              onToggleStage={
                mode === 'unstaged' && onStage
                  ? () => onStage(file.path)
                  : mode === 'staged' && onUnstage
                    ? () => onUnstage(file.path)
                    : undefined
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
