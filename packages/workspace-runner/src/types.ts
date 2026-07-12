/**
 * Structured process request/result types (spec section 21.2, 21.7).
 * The renderer never provides an arbitrary executable path for protected
 * operations: trusted backend code resolves a KnownExecutable id through
 * the tool registry.
 */

export type RiskLevel = 'observe' | 'local-reversible' | 'remote' | 'destructive';

export type OperationState =
  | 'created'
  | 'awaiting_permission'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'partially_succeeded'
  | 'needs_user_input';

export interface ProcessRequest {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly projectId?: string;
  /** Resolved by the tool registry — never a renderer-supplied path. */
  readonly executableId: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface ProcessReceipt {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly executable: string;
  /** Redacted, display-safe command line. */
  readonly commandDisplay: string;
  readonly state: Extract<OperationState, 'succeeded' | 'failed' | 'cancelled'>;
  readonly exitCode: number | null;
  readonly startedAt: string;
  readonly endedAt: string;
  /** Redacted output (bounded). */
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Executable resolution is injected so tests can stub it and so the
 * renderer can never influence it (spec section 33: dependency injection
 * for executable resolution and process spawning).
 */
export type ExecutableResolver = (executableId: string) => Promise<string>;
