/**
 * Terminal session lifecycle model (spec section 15.4 TERM-004, entity
 * fields in spec section 23.2.3).
 */

export type TerminalSessionState = 'running' | 'exited';

export interface TerminalSessionInfo {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly shell: string;
  readonly cwd: string;
  readonly pid: number;
  readonly state: TerminalSessionState;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly lastOutputAt: string | null;
  /**
   * "Running foreground operation where detectable" (TERM-004). Real
   * detection needs shell-integration hooks (OSC 133 prompt markers) that
   * are out of scope for M4 — always null until that lands.
   */
  readonly runningForegroundOperation: string | null;
}

/**
 * TERM-002: a session is permanently bound to the workspace/project it was
 * created under. Switching the active workspace hides sessions bound
 * elsewhere — it never rebinds them — so "is this session visible right
 * now" is a pure projection of session.workspaceId against whichever
 * workspace is currently active, not stored state on the session itself.
 */
export function isSessionVisible(session: TerminalSessionInfo, activeWorkspaceId: string | null): boolean {
  return activeWorkspaceId !== null && session.workspaceId === activeWorkspaceId;
}
