/**
 * Main-process business logic for M4's project flows: create/clone
 * (PRJ-001/004), dependency installation (PRJ-005), and development
 * server management (PRJ-006). Real process spawning (git, npm/yarn/pnpm,
 * dev servers) happens here — deliberately outside the storage worker,
 * which per ADR-003 only ever owns the database — and every mutation is
 * recorded back through `storage` (a `StorageClient`-shaped caller) so it
 * still gets a durable receipt and lives in one place.
 *
 * `storage` is typed as the minimal `StorageCaller` interface rather than
 * the concrete `StorageClient` class so tests can inject a fake that talks
 * directly to `handleStorageRequest` against a real temp-directory SQLite
 * database — the same "real but sandboxed" approach as
 * tests/integration/m2-storage-handlers.test.ts — without needing Electron.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CloneProjectInput,
  CreateProjectFromTemplateInput,
  DetectPackageManagerInput,
  DetectProjectInput,
  DevProcessInfo,
  InstallDependenciesInput,
  InstallDependenciesResult,
  JsPackageManagerId,
  PackageManagerDetection,
  Project,
  ProjectDetectionReport,
  ProjectTemplateSummary,
  ProjectTrustDecisionInput,
  StartDevServerInput,
  StopDevServerInput,
} from '@space/contracts';
import { TrustGateError, assertTrusted } from '@space/domain';
import { BUILT_IN_PROJECT_TEMPLATES, detectDevScript, findProjectTemplate, installCommandFor } from '@space/environment';
import { cloneRepository, createNodeGitExecutor, type GitExecutor } from '@space/git-engine';
import {
  detectListeningUrl,
  runProcess,
  startDetachedProcess,
  type DetachedProcessHandle,
  type ExecutableResolver,
} from '@space/workspace-runner';
import { buildSpaceEnvironment } from './environment-policy';
import type { StorageMethod } from './storage-protocol';

export interface StorageCaller {
  call<T>(method: StorageMethod, payload: unknown): Promise<T>;
}

export interface ProjectHandlersOptions {
  readonly resolveExecutable?: ExecutableResolver;
  readonly gitExecutor?: GitExecutor;
  /**
   * M8: fires the `dev-process-exited` automation trigger (spec 18.2) from
   * the one place a dev process's exit is already observed — no parallel
   * detection. Optional and late-bindable (a plain callback, not a
   * constructor dependency on `AutomationHandlers`) because
   * `createAutomationHandlers` itself depends on `ProjectHandlers`
   * (`automation-handlers.ts` calls `projectHandlers.detectPackageManager`)
   * — main.ts wires this after both are constructed, same "mutable hook
   * set after the fact" shape as `fireAutomationTrigger`'s call sites.
   */
  readonly onDevProcessExited?: (event: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly devProcessId: string;
    readonly exitCode: number | null;
    readonly state: 'stopped' | 'crashed';
  }) => void;
}

const passthroughResolver: ExecutableResolver = async (executableId) => executableId;

function toTemplateSummary(template: (typeof BUILT_IN_PROJECT_TEMPLATES)[number]): ProjectTemplateSummary {
  return {
    id: template.id,
    displayName: template.displayName,
    supportedPlatforms: template.supportedPlatforms,
    requiredExecutables: template.requiredExecutables,
    userEditableOptions: template.userEditableOptions,
    expectedFiles: template.expectedFiles,
    verifyCommand: template.verifyCommand,
    devCommand: template.devCommand,
    defaultIgnoreRules: template.defaultIgnoreRules,
  };
}

/**
 * Records a completed operation's receipt (spec section 33) — exported so
 * git-handlers.ts (M5) reuses the exact same call shape rather than a
 * parallel copy, since both live outside the storage worker and both need
 * the receipt/activity hook `operation.recordCompleted` triggers in
 * storage-handlers.ts.
 */
export async function recordOperation(
  storage: StorageCaller,
  input: {
    readonly workspaceId: string;
    readonly projectId: string | null;
    readonly type: string;
    readonly humanSummary: string;
    readonly startedAt: string;
    readonly state: 'succeeded' | 'failed';
    readonly exitCode: number | null;
    readonly partialState?: unknown;
    /** e.g. a commit SHA or branch name (spec 17.3's "links to the relevant commit"). */
    readonly subjectRef?: string | null;
  },
): Promise<void> {
  await storage.call('operation.recordCompleted', {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    type: input.type,
    risk: 'local-reversible',
    humanSummary: input.humanSummary,
    startedAt: input.startedAt,
    endedAt: new Date().toISOString(),
    state: input.state,
    exitCode: input.exitCode,
    partialState: input.partialState,
    subjectRef: input.subjectRef ?? null,
  });
}

export function createProjectHandlers(storage: StorageCaller, options: ProjectHandlersOptions = {}) {
  const resolveExecutable = options.resolveExecutable ?? passthroughResolver;
  const gitExecutor = options.gitExecutor ?? createNodeGitExecutor();
  const liveDevProcesses = new Map<string, DetachedProcessHandle>();
  const expectedStops = new Set<string>();

  async function detect(input: DetectProjectInput): Promise<ProjectDetectionReport> {
    return storage.call('project.detect', input);
  }

  async function detectPackageManager(input: DetectPackageManagerInput): Promise<PackageManagerDetection> {
    return storage.call('project.detectPackageManager', input);
  }

  async function trustDecision(input: ProjectTrustDecisionInput): Promise<Project> {
    return storage.call('project.trustDecision', input);
  }

  function listTemplates(): ProjectTemplateSummary[] {
    return BUILT_IN_PROJECT_TEMPLATES.map(toTemplateSummary);
  }

  async function createFromTemplate(input: CreateProjectFromTemplateInput): Promise<Project> {
    const template = findProjectTemplate(input.templateId);
    if (!template) {
      throw new Error(`Unknown project template: ${input.templateId}`);
    }
    const target = path.join(input.destinationParentDirectory, input.name);
    if (fs.existsSync(target)) {
      throw new Error(`"${target}" already exists`);
    }
    fs.mkdirSync(target, { recursive: false });

    const command = template.creationCommand(input.options ?? {}, input.name);
    const operationId = randomUUID();
    const startedAt = new Date().toISOString();

    const receipt = await runProcess(
      {
        operationId,
        workspaceId: input.workspaceId,
        executableId: command.executable,
        args: [...command.args],
        cwd: target,
        env: buildSpaceEnvironment(),
      },
      { resolveExecutable },
    );

    await recordOperation(storage, {
      workspaceId: input.workspaceId,
      projectId: null,
      type: 'project.createFromTemplate',
      humanSummary: `Create project "${input.name}" from template "${template.displayName}"`,
      startedAt,
      state: receipt.state === 'succeeded' ? 'succeeded' : 'failed',
      exitCode: receipt.exitCode,
      partialState: receipt.state === 'succeeded' ? undefined : { stderr: receipt.stderr, stdout: receipt.stdout },
    });

    if (receipt.state !== 'succeeded') {
      throw new Error(`Project creation failed: ${receipt.stderr.trim() || receipt.stdout.trim() || 'unknown error'}`);
    }

    return storage.call('project.add', { workspaceId: input.workspaceId, canonicalPath: target, name: input.name });
  }

  async function clone(input: CloneProjectInput): Promise<Project> {
    const name = input.name?.trim() || input.remoteUrl.replace(/\.git$/, '').split(/[/\\]/).pop() || 'project';
    const target = path.join(input.destinationParentDirectory, name);
    if (fs.existsSync(target)) {
      throw new Error(`"${target}" already exists`);
    }

    const startedAt = new Date().toISOString();
    try {
      await cloneRepository(
        {
          remoteUrl: input.remoteUrl,
          destination: target,
          timeoutMs: 5 * 60_000,
          ...(input.branch !== undefined ? { branch: input.branch } : {}),
        },
        gitExecutor,
      );
    } catch (error) {
      await recordOperation(storage, {
        workspaceId: input.workspaceId,
        projectId: null,
        type: 'project.clone',
        humanSummary: `Clone "${input.remoteUrl}"`,
        startedAt,
        state: 'failed',
        exitCode: 1,
        partialState: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await recordOperation(storage, {
      workspaceId: input.workspaceId,
      projectId: null,
      type: 'project.clone',
      humanSummary: `Clone "${input.remoteUrl}"`,
      startedAt,
      state: 'succeeded',
      exitCode: 0,
    });

    return storage.call('project.add', { workspaceId: input.workspaceId, canonicalPath: target, name });
  }

  async function installDependencies(input: InstallDependenciesInput): Promise<InstallDependenciesResult> {
    const project = await storage.call<Project>('project.get', { projectId: input.projectId });
    assertTrusted({
      trustState: project.trustState,
      operation: 'package-install',
      ...(input.allowOnce !== undefined ? { allowOnce: input.allowOnce } : {}),
    });

    let packageManager = input.packageManager;
    if (!packageManager) {
      const detection = await detectPackageManager({ canonicalPath: project.canonicalPath });
      if (detection.resolution !== 'single' || !detection.packageManager) {
        throw new Error(
          detection.resolution === 'conflict'
            ? 'Multiple incompatible lockfiles were found; choose a package manager explicitly.'
            : 'No lockfile was found; choose a package manager explicitly.',
        );
      }
      packageManager = detection.packageManager;
    }

    const command = installCommandFor(packageManager);
    const startedAt = new Date().toISOString();
    const receipt = await runProcess(
      {
        operationId: randomUUID(),
        workspaceId: project.workspaceId,
        projectId: project.id,
        executableId: command.executable,
        args: [...command.args],
        cwd: project.canonicalPath,
        env: buildSpaceEnvironment(),
        timeoutMs: 10 * 60_000,
      },
      { resolveExecutable },
    );

    await recordOperation(storage, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      type: 'project.installDependencies',
      humanSummary: `Install dependencies for "${project.name}" via ${packageManager}`,
      startedAt,
      state: receipt.state === 'succeeded' ? 'succeeded' : 'failed',
      exitCode: receipt.exitCode,
      partialState: receipt.state === 'succeeded' ? undefined : { stderr: receipt.stderr },
    });

    return { packageManager, succeeded: receipt.state === 'succeeded', exitCode: receipt.exitCode };
  }

  function readPackageScripts(canonicalPath: string): Record<string, string> | undefined {
    try {
      const raw = fs.readFileSync(path.join(canonicalPath, 'package.json'), 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && 'scripts' in parsed) {
        return (parsed as { scripts?: Record<string, string> }).scripts;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  async function startDevServer(input: StartDevServerInput): Promise<DevProcessInfo> {
    const project = await storage.call<Project>('project.get', { projectId: input.projectId });
    assertTrusted({
      trustState: project.trustState,
      operation: 'lifecycle-script',
      ...(input.allowOnce !== undefined ? { allowOnce: input.allowOnce } : {}),
    });

    const scriptName = detectDevScript(readPackageScripts(project.canonicalPath));
    if (!scriptName) {
      throw new Error(`No "dev" or "start" script was found in "${project.name}"'s package.json`);
    }

    const detection = await detectPackageManager({ canonicalPath: project.canonicalPath });
    const packageManager: JsPackageManagerId = detection.packageManager ?? 'npm';

    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const handle = await startDetachedProcess(
      {
        operationId: id,
        workspaceId: project.workspaceId,
        projectId: project.id,
        executableId: packageManager,
        args: ['run', scriptName],
        cwd: project.canonicalPath,
        env: buildSpaceEnvironment(),
      },
      { resolveExecutable },
    );

    const commandDisplay = `${packageManager} run ${scriptName}`;
    const record = await storage.call<DevProcessInfo>('devProcess.recordStart', {
      id,
      workspaceId: project.workspaceId,
      projectId: project.id,
      commandDisplay,
      cwd: project.canonicalPath,
      pid: handle.pid,
      startedAt,
    });

    liveDevProcesses.set(id, handle);
    let urlDetected = false;
    handle.onOutput((chunk) => {
      if (urlDetected) {
        return;
      }
      const url = detectListeningUrl(chunk);
      if (url) {
        urlDetected = true;
        void storage.call('devProcess.setDetectedUrl', { id, url });
      }
    });
    handle.onExit((exitCode) => {
      liveDevProcesses.delete(id);
      const wasExplicitStop = expectedStops.delete(id);
      const state = wasExplicitStop || exitCode === 0 ? 'stopped' : 'crashed';
      void storage.call('devProcess.markStopped', { id, state, exitCode, endedAt: new Date().toISOString() });
      options.onDevProcessExited?.({ workspaceId: project.workspaceId, projectId: project.id, devProcessId: id, exitCode, state });
    });

    return record;
  }

  async function stopDevServer(input: StopDevServerInput): Promise<void> {
    const handle = liveDevProcesses.get(input.devProcessId);
    if (!handle) {
      return;
    }
    expectedStops.add(input.devProcessId);
    handle.kill('SIGTERM');
  }

  async function listDevServers(projectId: string): Promise<DevProcessInfo[]> {
    return storage.call('devProcess.list', { projectId });
  }

  /** Kills every dev server this process instance started — called on app quit. */
  function stopAllDevServers(): void {
    for (const [id, handle] of liveDevProcesses) {
      expectedStops.add(id);
      handle.kill('SIGTERM');
    }
  }

  return {
    detect,
    detectPackageManager,
    trustDecision,
    listTemplates,
    createFromTemplate,
    clone,
    installDependencies,
    startDevServer,
    stopDevServer,
    listDevServers,
    stopAllDevServers,
  };
}

export type ProjectHandlers = ReturnType<typeof createProjectHandlers>;
export { TrustGateError };
