import { GitBranch, TerminalSquare } from 'lucide-react';
import type { EnvironmentScanResult, GitStatusSummary, Project } from '@space/contracts';
import { StatusDot } from '@space/ui';

interface StatusBarProps {
  readonly workspaceName: string | null;
  readonly project: Project | null;
  readonly gitStatus: GitStatusSummary | null;
  readonly changedFileCount: number;
  readonly terminalCount: number;
  readonly envScan: EnvironmentScanResult | null;
}

/** Bottom status strip — every segment is a real value already loaded elsewhere in the shell; nothing here fetches on its own. */
export function StatusBar({ workspaceName, project, gitStatus, changedFileCount, terminalCount, envScan }: StatusBarProps) {
  const nodeTool = envScan?.tools.find((tool) => tool.toolId === 'node');
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-sidebar px-3 text-[11px] text-fg-muted">
      <div className="flex items-center gap-3">
        {workspaceName && (
          <span className="flex items-center gap-1.5">
            <StatusDot tone="success" />
            {workspaceName}
          </span>
        )}
        {project && <span className="text-fg">{project.name}</span>}
        {gitStatus && (
          <span className="flex items-center gap-1">
            <GitBranch size={11} />
            {gitStatus.branch.detached ? '(detached)' : gitStatus.branch.branchName ?? '—'}
          </span>
        )}
        {project && <span>{changedFileCount} changes</span>}
        {gitStatus && gitStatus.conflictedFiles.length > 0 && <span className="text-danger">{gitStatus.conflictedFiles.length} conflicts</span>}
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <TerminalSquare size={11} />
          {terminalCount} terminal{terminalCount === 1 ? '' : 's'}
        </span>
        {nodeTool?.found && <span>Node {nodeTool.version}</span>}
        {envScan && <span>{envScan.platform === 'darwin' ? 'macOS' : 'Windows'}</span>}
      </div>
    </footer>
  );
}
