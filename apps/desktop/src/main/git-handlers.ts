/**
 * Main-process business logic for M5's Git surface (GIT-001..009, spec
 * sections 11-12): status, staging, commit, branches, history, fetch/pull/
 * push, and conflict continue/abort against a Project's real `.git`
 * repository. Mirrors project-handlers.ts's shape: real work (spawning
 * `git`, touching the repository's filesystem) happens here, outside the
 * storage worker, and every mutation is recorded back through `storage`
 * (`recordOperation`, the same helper project-handlers.ts uses) so it
 * picks up a durable receipt and — via storage-handlers.ts's
 * `operation.recordCompleted` hook — a real activity event, with no
 * separate wiring in this file.
 *
 * Mutating operations for a given repository are serialised through a
 * single `RepositoryOperationQueue` (spec 11.13: never one global lock, so
 * two different repositories' commits never block each other); `status`
 * reads are coalesced through the same queue so a burst of callers shares
 * one `git status` in flight.
 */
import {
  abortOperation,
  configGetArgs,
  continueOperation,
  createBranch,
  createFsHistoryCache,
  createNodeGitDirFs,
  createNodeGitExecutor,
  deleteBranch,
  deriveConflictState,
  fetchRemote,
  forEachRefArgs,
  getFullRepositoryStatus,
  HistoryStore,
  parseForEachRefOutput,
  pullRemote,
  pushToRemote,
  readRepoLocalIdentity,
  resolveCommitIdentity,
  RepositoryOperationQueue,
  runCommit,
  stageFiles,
  switchBranch as switchBranchEngine,
  unstageFiles,
  type CommitOutcome,
  type ConflictState,
  type FullRepositoryStatus,
  type GitExecutor,
  type GitIdentity,
  type OperationOutcome as EngineOperationOutcome,
  type RefEntry,
  type RemoteCommandOutcome,
  type RepositoryOperationState,
} from '@space/git-engine';
import type {
  GitCommitInput,
  GitCommitResult,
  GitConflictState,
  GitCreateBranchInput,
  GitDeleteBranchInput,
  GitFetchInput,
  GitHistoryLoadInput,
  GitHistoryPage,
  GitOperationOutcome,
  GitOperationState,
  GitProjectInput,
  GitPullInput,
  GitPushInput,
  GitRefEntry,
  GitRemoteResult,
  GitStageInput,
  GitStatusSummary,
  GitSwitchBranchInput,
  Project,
} from '@space/contracts';
import { recordOperation, type StorageCaller } from './project-handlers';

export interface GitHandlersOptions {
  readonly gitExecutor?: GitExecutor;
  /** Directory HistoryStore's disk cache writes into; one JSON file per repository. */
  readonly historyCacheDir: string;
}

function toGitOperationState(state: RepositoryOperationState): GitOperationState {
  switch (state.kind) {
    case 'rebase':
      return { kind: 'rebase', interactive: state.interactive };
    case 'cherry-pick':
      return { kind: 'cherry-pick', sequencer: state.sequencer };
    case 'revert':
      return { kind: 'revert', sequencer: state.sequencer };
    default:
      return { kind: state.kind };
  }
}

function toGitStatusSummary(full: FullRepositoryStatus): GitStatusSummary {
  const conflictedFiles = full.status.entries
    .filter((entry) => entry.kind === 'unmerged')
    .map((entry) => entry.path);
  return {
    branch: full.status.branch,
    entries: full.status.entries.map((entry) =>
      entry.kind === 'ordinary'
        ? { kind: 'ordinary', path: entry.path, indexStatus: entry.indexStatus, worktreeStatus: entry.worktreeStatus, submodule: entry.submodule }
        : entry.kind === 'renamed-or-copied'
          ? {
              kind: 'renamed-or-copied',
              path: entry.path,
              originalPath: entry.originalPath,
              indexStatus: entry.indexStatus,
              worktreeStatus: entry.worktreeStatus,
              similarityScore: entry.similarityScore,
              submodule: entry.submodule,
            }
          : entry.kind === 'unmerged'
            ? { kind: 'unmerged', path: entry.path, conflictCode: entry.conflictCode, submodule: entry.submodule }
            : { kind: entry.kind, path: entry.path },
    ),
    operationState: toGitOperationState(full.operationState),
    conflictedFiles,
  };
}

function toGitRefEntry(ref: RefEntry): GitRefEntry {
  return {
    refname: ref.refname,
    kind: ref.kind,
    shortName: ref.shortName,
    sha: ref.sha,
    peeledSha: ref.peeledSha,
    isHead: ref.isHead,
    upstream: ref.upstream,
    ahead: ref.ahead,
    behind: ref.behind,
    upstreamGone: ref.upstreamGone,
    subject: ref.subject,
  };
}

export function createGitHandlers(storage: StorageCaller, options: GitHandlersOptions) {
  const gitExecutor = options.gitExecutor ?? createNodeGitExecutor();
  const gitDirFs = createNodeGitDirFs();
  const historyCache = createFsHistoryCache(options.historyCacheDir);
  const queue = new RepositoryOperationQueue();
  const historyStores = new Map<string, HistoryStore>();

  async function requireProject(projectId: string): Promise<Project> {
    return storage.call<Project>('project.get', { projectId });
  }

  function repoCwd(project: Project): string {
    if (!project.repositoryRoot) {
      throw new Error(`Project "${project.name}" is not a Git repository`);
    }
    return project.repositoryRoot;
  }

  async function readFullStatus(cwd: string): Promise<FullRepositoryStatus> {
    return getFullRepositoryStatus(cwd, gitExecutor, gitDirFs);
  }

  /**
   * Runs a mutating git action and always leaves a receipt (spec section
   * 33: "every mutating command has a corresponding receipt") — succeeded
   * or failed, mirroring project-handlers.ts's clone()'s try/catch shape
   * rather than only recording the happy path. `subjectRefOf` computes the
   * receipt's subjectRef (spec 17.3's "links to the relevant commit") from
   * the action's own result, since e.g. a commit's SHA is only known after
   * it runs.
   */
  async function recordMutation<T>(
    project: Project,
    type: string,
    humanSummary: string,
    action: () => Promise<T>,
    subjectRefOf?: (result: T) => string | null,
  ): Promise<T> {
    const startedAt = new Date().toISOString();
    try {
      const result = await action();
      await recordOperation(storage, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        type,
        humanSummary,
        startedAt,
        state: 'succeeded',
        exitCode: 0,
        subjectRef: subjectRefOf ? subjectRefOf(result) : null,
      });
      return result;
    } catch (error) {
      await recordOperation(storage, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        type,
        humanSummary,
        startedAt,
        state: 'failed',
        exitCode: 1,
        partialState: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  async function status(input: GitProjectInput): Promise<GitStatusSummary> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    // Coalesced per repository first (spec 11.13), then bounded globally
    // (spec 27.4) — a burst of *distinct* repositories' status refreshes
    // still cannot exceed the concurrent-read cap.
    const full = await queue.coalesceStatusRefresh(cwd, () => queue.enqueueRead(() => readFullStatus(cwd)));
    return toGitStatusSummary(full);
  }

  async function stage(input: GitStageInput): Promise<void> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    await queue.enqueueMutating(cwd, () => stageFiles(cwd, input.paths, gitExecutor));
  }

  async function unstage(input: GitStageInput): Promise<void> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    await queue.enqueueMutating(cwd, () => unstageFiles(cwd, input.paths, gitExecutor));
  }

  /**
   * Resolves the commit identity from global `git config` (spec 11.6's
   * "workspace identity" — Space has no per-workspace identity settings UI
   * yet, so the machine's global git identity is the only real, non-
   * fabricated source available) with a repo-local override honored the
   * same way plain `git commit` would (spec 11.6 requires override to be
   * an explicit acknowledged action; there is no such UI step yet either,
   * so a repo-local identity is surfaced via `mismatch` but never silently
   * substituted).
   */
  async function resolveIdentity(cwd: string): Promise<GitIdentity> {
    const [name, email] = await Promise.all([
      gitExecutor(configGetArgs('user.name', 'global'), { cwd }),
      gitExecutor(configGetArgs('user.email', 'global'), { cwd }),
    ]);
    if (name.exitCode !== 0 || !name.stdout.trim() || email.exitCode !== 0 || !email.stdout.trim()) {
      throw new Error(
        'No Git author identity is configured (run "git config --global user.name" / "user.email" first)',
      );
    }
    const workspaceIdentity: GitIdentity = {
      name: name.stdout.trim(),
      email: email.stdout.trim(),
      signingPolicy: 'none',
      signingKeyId: null,
    };
    const repoLocal = await readRepoLocalIdentity(cwd, gitExecutor);
    return resolveCommitIdentity({ workspaceIdentity, repoLocal, overrideAcknowledged: false }).identity;
  }

  async function commit(input: GitCommitInput): Promise<GitCommitResult> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    const firstLine = input.message.split('\n')[0];

    return recordMutation(
      project,
      'git.commit',
      `Commit "${firstLine}"`,
      async () => {
        const identity = await resolveIdentity(cwd);
        const outcome: CommitOutcome = await queue.enqueueMutating(cwd, () =>
          runCommit(cwd, { identity, message: input.message }, gitExecutor),
        );
        return outcome;
      },
      (outcome) => outcome.sha,
    );
  }

  async function listBranches(input: GitProjectInput): Promise<GitRefEntry[]> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    const result = await gitExecutor(forEachRefArgs(), { cwd });
    if (result.exitCode !== 0) {
      throw new Error(`git for-each-ref failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`);
    }
    return parseForEachRefOutput(result.stdout).map(toGitRefEntry);
  }

  async function createBranchHandler(input: GitCreateBranchInput): Promise<void> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    await recordMutation(
      project,
      'git.branch.create',
      `Create branch "${input.name}"`,
      () => queue.enqueueMutating(cwd, () => createBranch(cwd, input.name, input.fromCommit, gitExecutor)),
      () => input.name,
    );
  }

  async function switchBranchHandler(input: GitSwitchBranchInput): Promise<void> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    await recordMutation(
      project,
      'git.branch.switch',
      `Switch to branch "${input.name}"`,
      () => queue.enqueueMutating(cwd, () => switchBranchEngine(cwd, input.name, gitExecutor)),
      () => input.name,
    );
  }

  async function deleteBranchHandler(input: GitDeleteBranchInput): Promise<void> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    await recordMutation(
      project,
      'git.branch.delete',
      `Delete branch "${input.name}"`,
      () =>
        queue.enqueueMutating(cwd, () =>
          deleteBranch(cwd, input.name, { force: input.force, confirmed: input.confirmed }, gitExecutor),
        ),
      () => input.name,
    );
  }

  function historyStoreFor(project: Project, cwd: string): HistoryStore {
    const existing = historyStores.get(project.id);
    if (existing) {
      return existing;
    }
    const store = new HistoryStore({ cwd, repoKey: project.id, executor: gitExecutor, cache: historyCache });
    historyStores.set(project.id, store);
    return store;
  }

  async function loadHistory(input: GitHistoryLoadInput): Promise<GitHistoryPage> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    const store = historyStoreFor(project, cwd);
    // History paging is a non-mutating read, so it goes through the global
    // concurrent-read cap (spec 27.4) rather than the per-repository
    // mutating lock — a burst of history requests across many open
    // projects must not spawn unbounded `git log` processes at once.
    const page = await queue.enqueueRead(() =>
      input.offset === 0 ? store.loadInitial(input.count) : store.getPage(input.offset, input.count),
    );
    return {
      commits: page.commits.map((commit) => ({
        sha: commit.sha,
        parents: commit.parents,
        subject: commit.subject,
        ...(commit.body !== undefined ? { body: commit.body } : {}),
        authorName: commit.authorName,
        ...(commit.authorEmail !== undefined ? { authorEmail: commit.authorEmail } : {}),
        authoredAt: commit.authoredAt,
        committedAt: commit.committedAt,
        refs: commit.refs,
      })),
      totalIndexed: page.totalIndexed,
      fullyIndexed: page.fullyIndexed,
    };
  }

  /** Invalidates a project's in-memory history index — wired to the repository watcher's git-dir hint. */
  function invalidateHistory(projectId: string): void {
    historyStores.get(projectId)?.invalidate();
  }

  async function fetch(input: GitFetchInput): Promise<GitRemoteResult> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    const outcome: RemoteCommandOutcome = await recordMutation(
      project,
      'git.fetch',
      `Fetch from "${input.remoteName ?? 'origin'}"`,
      () => queue.enqueueMutating(cwd, () => fetchRemote(cwd, input.remoteName ?? 'origin', gitExecutor)),
    );
    invalidateHistory(project.id);
    return outcome;
  }

  async function pull(input: GitPullInput): Promise<GitRemoteResult> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    const outcome: RemoteCommandOutcome = await recordMutation(
      project,
      'git.pull',
      `Pull (${input.mode}) from "${input.remoteName ?? 'origin'}"`,
      () => queue.enqueueMutating(cwd, () => pullRemote(cwd, input.mode, input.remoteName ?? 'origin', input.branch, gitExecutor)),
    );
    invalidateHistory(project.id);
    return outcome;
  }

  async function push(input: GitPushInput): Promise<GitRemoteResult> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    return recordMutation(
      project,
      'git.push',
      `Push "${input.branch}" to "${input.remoteName ?? 'origin'}"`,
      () =>
        queue.enqueueMutating(cwd, () =>
          pushToRemote(
            cwd,
            {
              branch: input.branch,
              ...(input.remoteName !== undefined ? { remoteName: input.remoteName } : {}),
              ...(input.setUpstream !== undefined ? { setUpstream: input.setUpstream } : {}),
              ...(input.force !== undefined ? { force: input.force } : {}),
              ...(input.confirmed !== undefined ? { confirmed: input.confirmed } : {}),
            },
            gitExecutor,
          ),
        ),
      () => input.branch,
    );
  }

  async function conflictState(input: GitProjectInput): Promise<GitConflictState> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    const full = await readFullStatus(cwd);
    const derived: ConflictState = deriveConflictState(full.status, full.operationState);
    return {
      inConflict: derived.inConflict,
      operationState: toGitOperationState(derived.operation),
      conflictedFiles: derived.conflictedFiles,
    };
  }

  function toGitOperationOutcome(outcome: EngineOperationOutcome): GitOperationOutcome {
    return {
      completed: outcome.completed,
      remaining: toGitOperationState(outcome.remaining),
      stdout: outcome.stdout,
      stderr: outcome.stderr,
    };
  }

  async function continueConflict(input: GitProjectInput): Promise<GitOperationOutcome> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    return recordMutation(project, 'git.conflict.continue', `Continue "${project.name}"'s in-progress operation`, async () => {
      const full = await readFullStatus(cwd);
      const outcome = await queue.enqueueMutating(cwd, () =>
        continueOperation(cwd, full.gitDir, full.operationState, gitExecutor, gitDirFs),
      );
      return toGitOperationOutcome(outcome);
    });
  }

  async function abortConflict(input: GitProjectInput): Promise<GitOperationOutcome> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    return recordMutation(project, 'git.conflict.abort', `Abort "${project.name}"'s in-progress operation`, async () => {
      const full = await readFullStatus(cwd);
      const outcome = await queue.enqueueMutating(cwd, () =>
        abortOperation(cwd, full.gitDir, full.operationState, gitExecutor, gitDirFs),
      );
      return toGitOperationOutcome(outcome);
    });
  }

  return {
    status,
    stage,
    unstage,
    commit,
    listBranches,
    createBranch: createBranchHandler,
    switchBranch: switchBranchHandler,
    deleteBranch: deleteBranchHandler,
    loadHistory,
    invalidateHistory,
    fetch,
    pull,
    push,
    conflictState,
    continueConflict,
    abortConflict,
  };
}

export type GitHandlers = ReturnType<typeof createGitHandlers>;
