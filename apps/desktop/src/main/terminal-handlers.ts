/**
 * Main-process business logic for the plain "Open Terminal" flow
 * (TERM-001..006). Mirrors project-handlers.ts/git-handlers.ts's shape:
 * real construction work happens here, outside the storage worker and
 * outside ipc.ts's routing layer.
 *
 * `packages/terminal/src/protocol.ts`'s `TerminalCreateRequest` requires a
 * full `env` — "Final environment, already built by the Workspace Process
 * Runner (TERM-003) — never raw process.env" — and a real `cwd`, but the
 * renderer's `CreateTerminalInput` only carries `workspaceId`/`projectId`/
 * `cols`/`rows`. This is the one place that gap gets closed: `env` comes
 * from the same `buildSpaceEnvironment()` project-handlers.ts already uses
 * for dev-server/install processes (spec 5.3), and `cwd` is the bound
 * project's canonical path when one exists, falling back to the user's
 * home directory otherwise — the same fallback `githubAuthStartLogin`
 * already uses in ipc.ts for its login PTY, which has no project either.
 */
import type { CreateTerminalInput, Project } from '@space/contracts';
import type { TerminalWorkerEvent, TerminalWorkerMethod } from '@space/terminal';
import { buildSpaceEnvironment } from './environment-policy';
import type { StorageCaller } from './project-handlers';

export interface TerminalCaller {
  call<T>(method: TerminalWorkerMethod, payload: unknown): Promise<T>;
  subscribe(sessionId: string, listener: (event: TerminalWorkerEvent) => void): () => void;
}

export interface CreatedTerminalSession {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly shell: string;
  readonly cwd: string;
  readonly pid: number;
  readonly startedAt: string;
}

export interface TerminalHandlersOptions {
  readonly terminal: TerminalCaller;
  /** cwd fallback when the session has no bound project (TERM-002). */
  readonly homeDirectory: string;
}

export function createTerminalHandlers(storage: StorageCaller, options: TerminalHandlersOptions) {
  async function resolveCwd(projectId: string | null): Promise<string> {
    if (!projectId) {
      return options.homeDirectory;
    }
    const project = await storage.call<Project>('project.get', { projectId });
    return project.canonicalPath;
  }

  async function createTerminal(input: CreateTerminalInput): Promise<CreatedTerminalSession> {
    const projectId = input.projectId ?? null;
    const cwd = await resolveCwd(projectId);

    return options.terminal.call<CreatedTerminalSession>('terminal.create', {
      workspaceId: input.workspaceId,
      projectId,
      cwd,
      env: buildSpaceEnvironment(),
      cols: input.cols,
      rows: input.rows,
    });
  }

  return { createTerminal };
}

export type TerminalHandlers = ReturnType<typeof createTerminalHandlers>;
