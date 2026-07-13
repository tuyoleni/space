/**
 * Main-process business logic for M7's intent/agent surface (spec
 * sections 13, 19). Mirrors git-handlers.ts's shape: real work (reading a
 * repository's real diff, applying a real patch, dispatching an agent
 * action) happens here, and every mutation still goes through the exact
 * same M4/M5/M6 handlers this file is handed — `gitHandlers`,
 * `projectHandlers`, and `githubHandlers` are not reimplemented, only
 * composed. `file.modify` and `project.runScript` are the two agent
 * actions with no direct M4-M6 IPC equivalent; both are built from
 * already-existing primitives (`applyPatchToWorktree`
 * from git-engine's GIT-004 patch machinery, and workspace-runner's
 * `runProcess`, the same process-spawning primitive `installDependencies`
 * already uses) and both route through `assertTrusted` exactly like every
 * other privileged project operation (spec 10.3/ADR-006).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyModelProposals,
  buildModelDisclosure,
  buildSelectionsFromFileDiffs,
  composePatchFromSelections,
  computeIntrinsicRisk,
  dispatchAgentAction,
  generateRuleBasedIntentGroups,
  parseAgentActionPlan,
  type AgentAction,
  type AgentActionHandlers,
  type ChangeIntent,
  type DiffLookup,
  type DiffSelection,
  type ModelDisclosure,
  type ModelProvider,
  type StagedState,
} from '@space/agent';
import { assertTrusted, type AgentStandingPermission } from '@space/domain';
import {
  applyPatchToWorktree,
  createNodeGitExecutor,
  diffPatchArgs,
  parseUnifiedDiff,
  stagePatch,
  type FileDiff,
  type GitExecutor,
} from '@space/git-engine';
import { runProcess, type ExecutableResolver } from '@space/workspace-runner';
import type { GitCommitResult, JsPackageManagerId, Project } from '@space/contracts';
import { buildSpaceEnvironment } from './environment-policy';
import type { GitHandlers } from './git-handlers';
import type { GithubHandlers } from './github-handlers';
import { recordOperation, type StorageCaller } from './project-handlers';

/**
 * Only the subset of ProjectHandlers this file actually calls, declared
 * narrowly (rather than importing the full `ProjectHandlers` type) so
 * tests can inject a minimal fake without constructing the whole real
 * `createProjectHandlers` dependency graph. The real `ProjectHandlers`
 * returned by `createProjectHandlers` satisfies this structurally.
 */
export interface AgentProjectHandlersDependency {
  installDependencies(input: {
    readonly projectId: string;
    readonly packageManager?: JsPackageManagerId;
    readonly allowOnce?: boolean;
  }): Promise<unknown>;
  detectPackageManager(input: { readonly canonicalPath: string }): Promise<{ readonly packageManager: JsPackageManagerId | null }>;
}

export interface AgentHandlersOptions {
  readonly gitExecutor?: GitExecutor;
  readonly resolveExecutable?: ExecutableResolver;
  readonly gitHandlers: GitHandlers;
  readonly projectHandlers: AgentProjectHandlersDependency;
  readonly githubHandlers: GithubHandlers;
  /** No implementation of this in the codebase calls a real provider (see ADR-008) — undefined is the correct default. */
  readonly modelProvider?: ModelProvider;
}

const passthroughResolver: ExecutableResolver = async (executableId) => executableId;

interface AgentPermissionRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly actionType: string;
  readonly grantedAt: string;
  readonly revokedAt: string | null;
}

function toStandingPermission(row: AgentPermissionRow): AgentStandingPermission {
  return {
    actionType: row.actionType,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    grantedAt: row.grantedAt,
    revoked: row.revokedAt !== null,
  };
}

export function createAgentHandlers(storage: StorageCaller, options: AgentHandlersOptions) {
  const gitExecutor = options.gitExecutor ?? createNodeGitExecutor();
  const resolveExecutable = options.resolveExecutable ?? passthroughResolver;
  const { gitHandlers, projectHandlers, githubHandlers } = options;

  async function requireProject(projectId: string): Promise<Project> {
    return storage.call<Project>('project.get', { projectId });
  }

  function repoCwd(project: Project): string {
    if (!project.repositoryRoot) {
      throw new Error(`Project "${project.name}" is not a Git repository`);
    }
    return project.repositoryRoot;
  }

  /** Reads both halves of the real diff (spec 13.1: "the source data is the real Git diff") — never fabricated, never re-parsed from anything but git's own machine-readable patch output. */
  async function loadRepositoryEvidence(cwd: string): Promise<DiffSelection[]> {
    const [unstagedRaw, stagedRaw] = await Promise.all([
      gitExecutor(diffPatchArgs({ cached: false }), { cwd }),
      gitExecutor(diffPatchArgs({ cached: true }), { cwd }),
    ]);
    const unstaged = buildSelectionsFromFileDiffs(parseUnifiedDiff(unstagedRaw.stdout), 'unstaged');
    const staged = buildSelectionsFromFileDiffs(parseUnifiedDiff(stagedRaw.stdout), 'staged');
    return [...staged, ...unstaged];
  }

  /** Snapshots the current diff once and serves lookups from that snapshot — used for both staleness detection and patch composition, so both see the exact same "fresh" state. */
  async function freshFileDiffLookup(cwd: string): Promise<DiffLookup> {
    const [unstagedRaw, stagedRaw] = await Promise.all([
      gitExecutor(diffPatchArgs({ cached: false }), { cwd }),
      gitExecutor(diffPatchArgs({ cached: true }), { cwd }),
    ]);
    const byKey = new Map<string, FileDiff>();
    for (const file of parseUnifiedDiff(unstagedRaw.stdout)) {
      byKey.set(`unstaged:${file.path}`, file);
    }
    for (const file of parseUnifiedDiff(stagedRaw.stdout)) {
      byKey.set(`staged:${file.path}`, file);
    }
    return {
      fileDiff: (filePath: string, staged: StagedState) => byKey.get(`${staged}:${filePath}`) ?? null,
    };
  }

  async function loadEvidence(input: { readonly projectId: string }): Promise<DiffSelection[]> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    return loadRepositoryEvidence(cwd);
  }

  function generateIntentGroups(evidence: readonly DiffSelection[]): ChangeIntent[] {
    return generateRuleBasedIntentGroups(evidence);
  }

  /**
   * Adds model-proposed groups on top of the rule-based ones, when a
   * model provider is configured (spec 13.3: model grouping is additive,
   * never a replacement for the always-available rule-based default).
   * Never called by anything in this milestone's own tests with a real
   * provider — see ADR-008.
   */
  async function generateIntentGroupsWithModel(evidence: readonly DiffSelection[], lookup: DiffLookup): Promise<ChangeIntent[]> {
    const ruleGroups = generateRuleBasedIntentGroups(evidence);
    if (!options.modelProvider) {
      return ruleGroups;
    }
    const disclosure: ModelDisclosure = buildModelDisclosure(evidence, lookup.fileDiff);
    const proposals = await options.modelProvider.proposeIntentGroups({ disclosure });
    return [...ruleGroups, ...applyModelProposals(evidence, proposals)];
  }

  /**
   * Composes a commit from selected evidence (spec 13.4 CHG-004): refreshes
   * the diff, refuses to proceed if any selection is stale, stages the
   * composed patch, then commits through the exact same, already-tested
   * `gitHandlers.commit` (GIT-005) — no separate commit implementation
   * lives here. Known simplification: this does not share GIT-009's
   * per-repository operation queue (private to git-handlers.ts), so a
   * concurrent direct `git.stage` call racing this composition is possible
   * in principle; acceptable for this milestone's scope.
   */
  async function composeCommit(input: {
    readonly projectId: string;
    readonly evidence: readonly DiffSelection[];
    readonly message: string;
  }): Promise<GitCommitResult> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    const lookup = await freshFileDiffLookup(cwd);
    const patchText = composePatchFromSelections(input.evidence, lookup);
    if (patchText.length > 0) {
      await stagePatch(cwd, patchText, gitExecutor);
    }
    return gitHandlers.commit({ projectId: input.projectId, message: input.message });
  }

  function resolveWithinProject(project: Project, relativePath: string): string {
    const root = path.resolve(project.canonicalPath);
    const resolved = path.resolve(root, relativePath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`Path "${relativePath}" escapes the project directory`);
    }
    return resolved;
  }

  const agentActionHandlers: AgentActionHandlers = {
    async fileRead(action, params) {
      const project = await requireProject(action.projectId);
      const target = resolveWithinProject(project, params.path);
      const content = fs.readFileSync(target, 'utf-8');
      return { content };
    },

    async fileModify(action, params) {
      const project = await requireProject(action.projectId);
      assertTrusted({
        trustState: project.trustState,
        operation: 'agent-file-modify',
        ...(params.allowOnce !== undefined ? { allowOnce: params.allowOnce } : {}),
      });
      const cwd = repoCwd(project);
      const startedAt = new Date().toISOString();
      try {
        await applyPatchToWorktree(cwd, params.patchText, gitExecutor);
        await recordOperation(storage, {
          workspaceId: project.workspaceId,
          projectId: project.id,
          type: 'agent.file.modify',
          humanSummary: `Agent modified files in "${project.name}" (${action.explanation})`,
          startedAt,
          state: 'succeeded',
          exitCode: 0,
        });
      } catch (error) {
        await recordOperation(storage, {
          workspaceId: project.workspaceId,
          projectId: project.id,
          type: 'agent.file.modify',
          humanSummary: `Agent modified files in "${project.name}" (${action.explanation})`,
          startedAt,
          state: 'failed',
          exitCode: 1,
          partialState: { error: error instanceof Error ? error.message : String(error) },
        });
        throw error;
      }
      return { applied: true };
    },

    async installDependencies(action, params) {
      return projectHandlers.installDependencies({
        projectId: action.projectId,
        ...(params.packageManager !== undefined ? { packageManager: params.packageManager } : {}),
        ...(params.allowOnce !== undefined ? { allowOnce: params.allowOnce } : {}),
      });
    },

    /**
     * spec 19.1's `project.runScript`: runs an existing `package.json`
     * script by name — never an arbitrary shell string (spec 39's
     * prohibition on `runAnyCommand`). Built from the same primitives
     * `installDependencies`/`startDevServer` already use
     * (`detectPackageManager` + `runProcess`), gated by the same project
     * trust check, rather than a new capability.
     */
    async runScript(action, params) {
      const project = await requireProject(action.projectId);
      assertTrusted({
        trustState: project.trustState,
        operation: 'lifecycle-script',
        ...(params.allowOnce !== undefined ? { allowOnce: params.allowOnce } : {}),
      });
      const detection = await projectHandlers.detectPackageManager({ canonicalPath: project.canonicalPath });
      const packageManager: JsPackageManagerId = detection.packageManager ?? 'npm';
      const startedAt = new Date().toISOString();
      const receipt = await runProcess(
        {
          operationId: randomUUID(),
          workspaceId: project.workspaceId,
          projectId: project.id,
          executableId: packageManager,
          args: ['run', params.scriptName],
          cwd: project.canonicalPath,
          env: buildSpaceEnvironment(),
        },
        { resolveExecutable },
      );
      await recordOperation(storage, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        type: 'agent.project.runScript',
        humanSummary: `Agent ran "${packageManager} run ${params.scriptName}" in "${project.name}"`,
        startedAt,
        state: receipt.state === 'succeeded' ? 'succeeded' : 'failed',
        exitCode: receipt.exitCode,
        partialState: receipt.state === 'succeeded' ? undefined : { stderr: receipt.stderr },
      });
      return receipt;
    },

    async gitStage(action, params) {
      return gitHandlers.stage({ projectId: action.projectId, paths: params.paths });
    },

    async gitCommit(action, params) {
      return gitHandlers.commit({ projectId: action.projectId, message: params.message });
    },

    async gitPush(action, params) {
      return gitHandlers.push({
        projectId: action.projectId,
        branch: params.branch,
        ...(params.remoteName !== undefined ? { remoteName: params.remoteName } : {}),
        ...(params.setUpstream !== undefined ? { setUpstream: params.setUpstream } : {}),
        ...(params.force !== undefined ? { force: params.force } : {}),
        ...(params.confirmed !== undefined ? { confirmed: params.confirmed } : {}),
      });
    },

    async githubCreatePullRequest(action, params) {
      return githubHandlers.prCreate(
        action.workspaceId,
        {
          title: params.title,
          body: params.body,
          base: params.base,
          head: params.head,
          ...(params.draft !== undefined ? { draft: params.draft } : {}),
          ...(params.reviewers !== undefined ? { reviewers: params.reviewers } : {}),
          ...(params.assignees !== undefined ? { assignees: params.assignees } : {}),
          ...(params.labels !== undefined ? { labels: params.labels } : {}),
        },
        params.host,
      );
    },
  };

  /**
   * The one entry point for executing an agent-proposed plan (spec 19.1,
   * 19.3). `rawAction` is treated as untrusted input regardless of source
   * — it is schema-validated inside `dispatchAgentAction` before anything
   * else happens. `confirmed` must come from an explicit user action, not
   * be inferred; this function does not decide confirmation, only carries
   * it through, plus resolving any live standing permission for `remote`-
   * risk actions (never usable for `destructive` ones, see
   * `assertAgentActionConfirmed`).
   */
  async function dispatchPlan(input: { readonly rawAction: unknown; readonly confirmed: boolean }): Promise<unknown> {
    const action = parseAgentActionPlan([input.rawAction])[0] as AgentAction;
    const permissionRow = await storage.call<AgentPermissionRow | null>('agentPermission.findActiveGrant', {
      workspaceId: action.workspaceId,
      projectId: action.projectId,
      actionType: action.type,
    });
    return dispatchAgentAction(action, agentActionHandlers, {
      confirmed: input.confirmed,
      standingPermission: permissionRow ? toStandingPermission(permissionRow) : null,
    });
  }

  async function grantPermission(input: {
    readonly workspaceId: string;
    readonly projectId: string | null;
    readonly actionType: string;
  }): Promise<AgentPermissionRow> {
    return storage.call<AgentPermissionRow>('agentPermission.grant', {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actionType: input.actionType,
      grantedAt: new Date().toISOString(),
    });
  }

  async function revokePermission(id: string): Promise<void> {
    await storage.call('agentPermission.revoke', { id, revokedAt: new Date().toISOString() });
  }

  async function listPermissions(workspaceId: string): Promise<AgentPermissionRow[]> {
    return storage.call<AgentPermissionRow[]>('agentPermission.list', { workspaceId });
  }

  return {
    loadEvidence,
    generateIntentGroups,
    generateIntentGroupsWithModel,
    composeCommit,
    dispatchPlan,
    grantPermission,
    revokePermission,
    listPermissions,
    computeIntrinsicRisk,
  };
}

export type AgentHandlers = ReturnType<typeof createAgentHandlers>;
