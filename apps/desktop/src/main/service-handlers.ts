/**
 * Home dashboard "Services": merges everything actually running for a
 * project into one list — the persisted dev-server records
 * project-handlers.ts already tracks, Docker/Podman containers whose mounts
 * live under the project's canonicalPath, and processes running inside the
 * project's own terminal sessions (children of the shell pid; the shell
 * itself is already shown in the Terminals card, so it's excluded here).
 *
 * Containers and terminal-child processes are never persisted to our own
 * database — like system-handlers.ts's `processes()`, they're re-derived
 * from real `docker`/`ps` output on every `list()` call, since Docker and
 * the OS are already the source of truth for whether they're running.
 */
import { nodeRunCommand } from '@space/environment';
import type { DevProcessInfo, Project, ServiceInfo, StopServiceInput, TerminalSessionInfo } from '@space/contracts';
import type { StorageCaller } from './project-handlers';

const CLI_TIMEOUT_MS = 4_000;
const PS_TIMEOUT_MS = 4_000;
const KILL_GRACE_MS = 3_000;

export interface ServiceHandlersOptions {
  readonly storage: StorageCaller;
  readonly devServers: {
    list(projectId: string): Promise<DevProcessInfo[]>;
    stop(input: { devProcessId: string }): Promise<void>;
  };
}

interface ContainerRuntime {
  readonly executable: 'docker' | 'podman';
}

/** Tries docker first, falls back to podman — whichever daemon actually answers `info`. */
async function detectContainerRuntime(): Promise<ContainerRuntime | null> {
  for (const executable of ['docker', 'podman'] as const) {
    const result = await nodeRunCommand(executable, ['info'], { timeoutMs: CLI_TIMEOUT_MS }).catch(() => null);
    if (result && result.exitCode === 0) {
      return { executable };
    }
  }
  return null;
}

interface RawContainer {
  readonly id: string;
  readonly name: string;
  readonly image: string;
}

async function listContainers(runtime: ContainerRuntime): Promise<RawContainer[]> {
  const result = await nodeRunCommand(runtime.executable, ['ps', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}'], {
    timeoutMs: CLI_TIMEOUT_MS,
  }).catch(() => null);
  if (!result || result.exitCode !== 0) {
    return [];
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [id, name, image] = line.split('\t');
      return { id: id ?? '', name: name ?? '', image: image ?? '' };
    })
    .filter((container) => container.id.length > 0);
}

/** Bind-mount sources + working dir for one container — used to match it back to a project's canonicalPath. */
async function containerPathsOf(runtime: ContainerRuntime, containerId: string): Promise<string[]> {
  const result = await nodeRunCommand(
    runtime.executable,
    ['inspect', containerId, '--format', '{{range .Mounts}}{{.Source}}\n{{end}}{{.Config.WorkingDir}}'],
    { timeoutMs: CLI_TIMEOUT_MS },
  ).catch(() => null);
  if (!result || result.exitCode !== 0) {
    return [];
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isUnder(candidate: string, root: string): boolean {
  const normalizedRoot = root.endsWith('/') ? root : `${root}/`;
  return candidate === root || candidate.startsWith(normalizedRoot);
}

async function containersForProject(project: Project): Promise<ServiceInfo[]> {
  const runtime = await detectContainerRuntime();
  if (!runtime) {
    return [];
  }
  const containers = await listContainers(runtime);
  const matched: ServiceInfo[] = [];
  for (const container of containers) {
    const paths = await containerPathsOf(runtime, container.id);
    if (!paths.some((candidate) => isUnder(candidate, project.canonicalPath))) {
      continue;
    }
    matched.push({
      id: container.id,
      projectId: project.id,
      kind: 'container',
      label: container.name || container.image,
      detail: container.image || null,
      pid: null,
      state: 'running',
      startedAt: null,
    });
  }
  return matched;
}

interface PsRow {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
}

/** Parses `ps -Ao pid,ppid,comm` — used to find each terminal shell's direct children. */
async function listProcessTree(): Promise<PsRow[]> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return [];
  }
  const result = await nodeRunCommand('ps', ['-Ao', 'pid,ppid,comm'], { timeoutMs: PS_TIMEOUT_MS }).catch(() => null);
  if (!result || result.exitCode !== 0) {
    return [];
  }
  const rows: PsRow[] = [];
  for (const line of result.stdout.split('\n').slice(1)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) {
      continue;
    }
    const [, pid, ppid, command] = match;
    rows.push({ pid: Number(pid), ppid: Number(ppid), command: (command ?? '').trim() });
  }
  return rows;
}

async function terminalProcessesForProject(project: Project, sessions: readonly TerminalSessionInfo[]): Promise<ServiceInfo[]> {
  const running = sessions.filter((session) => session.projectId === project.id && session.state === 'running');
  if (running.length === 0) {
    return [];
  }
  const rows = await listProcessTree();
  const services: ServiceInfo[] = [];
  for (const session of running) {
    for (const child of rows.filter((row) => row.ppid === session.pid)) {
      services.push({
        id: String(child.pid),
        projectId: project.id,
        kind: 'process',
        label: child.command.split('/').pop() || child.command,
        detail: `pid ${child.pid} · in terminal`,
        pid: child.pid,
        state: 'running',
        startedAt: null,
      });
    }
  }
  return services;
}

export interface ServiceHandlers {
  list(projectId: string): Promise<ServiceInfo[]>;
  stop(input: StopServiceInput): Promise<void>;
}

export function createServiceHandlers(options: ServiceHandlersOptions): ServiceHandlers {
  async function list(projectId: string): Promise<ServiceInfo[]> {
    const project = await options.storage.call<Project>('project.get', { projectId });
    const [devServers, sessions, containers] = await Promise.all([
      options.devServers.list(projectId),
      options.storage.call<TerminalSessionInfo[]>('terminal.list', { workspaceId: project.workspaceId }),
      containersForProject(project),
    ]);
    const devServerServices: ServiceInfo[] = devServers
      .filter((server) => server.state === 'running')
      .map((server) => ({
        id: server.id,
        projectId: server.projectId,
        kind: 'devServer',
        label: server.commandDisplay,
        detail: server.detectedUrl,
        pid: server.pid,
        state: server.state,
        startedAt: server.startedAt,
      }));
    const processServices = await terminalProcessesForProject(project, sessions);
    return [...devServerServices, ...containers, ...processServices];
  }

  async function stop(input: StopServiceInput): Promise<void> {
    if (input.kind === 'devServer') {
      await options.devServers.stop({ devProcessId: input.id });
      return;
    }
    if (input.kind === 'container') {
      const runtime = await detectContainerRuntime();
      if (!runtime) {
        throw new Error('No container runtime (docker/podman) available to stop this service.');
      }
      const result = await nodeRunCommand(runtime.executable, ['stop', input.id], { timeoutMs: CLI_TIMEOUT_MS }).catch(() => null);
      if (!result || result.exitCode !== 0) {
        throw new Error(`Failed to stop container ${input.id}.`);
      }
      return;
    }

    // kind === 'process': same SIGTERM-then-SIGKILL escalation as
    // project-handlers.ts's stopDevServer, just without the storage receipt
    // since this process was never one Space started or recorded.
    const pid = Number(input.id);
    if (!Number.isFinite(pid)) {
      return;
    }
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, KILL_GRACE_MS));
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already exited after SIGTERM — nothing left to escalate.
    }
  }

  return { list, stop };
}
