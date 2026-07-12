/**
 * Request/response + streaming-event protocol between the main process and
 * the terminal worker (spec sections 20.2.4, 22.1, 22.2). Terminal output
 * is a stream, not a single request/response, so unlike the storage
 * worker's protocol this also defines push `TerminalWorkerEvent`s that
 * arrive uncorrelated to any particular request — the main-process client
 * fans them out to `subscribe(sessionId, listener): Unsubscribe` callers,
 * mirroring the `operation.subscribe` shape in spec section 22.2.
 */
export interface TerminalCreateRequest {
  readonly workspaceId: string;
  readonly projectId: string | null;
  /** Overrides the platform default shell (TERM-001) when set. */
  readonly shell?: string;
  readonly cwd: string;
  /** Final environment, already built by the Workspace Process Runner (TERM-003) — never raw process.env. */
  readonly env: Readonly<Record<string, string>>;
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalWriteRequest {
  readonly sessionId: string;
  readonly data: string;
}

export interface TerminalResizeRequest {
  readonly sessionId: string;
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalDisposeRequest {
  readonly sessionId: string;
}

export type TerminalWorkerMethod =
  | 'terminal.create'
  | 'terminal.write'
  | 'terminal.resize'
  | 'terminal.dispose'
  | 'terminal.list';

export interface TerminalWorkerRequest {
  readonly id: string;
  readonly method: TerminalWorkerMethod;
  readonly payload: unknown;
}

export type TerminalWorkerResponse =
  | { readonly kind: 'response'; readonly id: string; readonly ok: true; readonly result: unknown }
  | { readonly kind: 'response'; readonly id: string; readonly ok: false; readonly error: string };

export type TerminalWorkerEvent =
  | {
      readonly kind: 'event';
      readonly type: 'output';
      readonly sessionId: string;
      /** Redaction is applied only to what is persisted (spec 15.5) — live frames are not mutated, so paste/typed secrets still render correctly. */
      readonly chunk: string;
      readonly sequence: number;
      readonly timestamp: string;
    }
  | {
      readonly kind: 'event';
      readonly type: 'exit';
      readonly sessionId: string;
      readonly exitCode: number | null;
      readonly signal: number | null;
      readonly timestamp: string;
    }
  | {
      readonly kind: 'event';
      readonly type: 'backpressure';
      readonly sessionId: string;
      readonly droppedBytes: number;
      readonly timestamp: string;
    };

export type TerminalWorkerMessage = TerminalWorkerResponse | TerminalWorkerEvent;
