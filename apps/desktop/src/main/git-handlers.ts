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
  applyStash as applyStashEngine,
  configGetArgs,
  continueOperation,
  createBranch,
  createFsHistoryCache,
  createNodeGitDirFs,
  createNodeGitExecutor,
  deleteBranch,
  mergeBranch as mergeBranchEngine,
  deriveConflictState,
  diffNumstatArgs,
  diffPatchArgs,
  dropStash as dropStashEngine,
  fetchRemote,
  parseDiffNumstatOutput,
  forEachRefArgs,
  getFullRepositoryStatus,
  HistoryStore,
  initRepository,
  CommitFailedError,
  listRemotes as listRemotesEngine,
  listStashes as listStashesEngine,
  listTags as listTagsEngine,
  listWorktrees as listWorktreesEngine,
  parseForEachRefOutput,
  pullRemote,
  pushToRemote,
  readRepoLocalIdentity,
  resolveCommitIdentity,
  resolveConflict as resolveConflictEngine,
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
  GitConflictResolveInput,
  GitConflictState,
  GitCreateBranchInput,
  GitDeleteBranchInput,
  GitMergeBranchInput,
  GitDiffStats,
  GitFetchInput,
  GitFileDiffInput,
  GitFileDiffResult,
  GitFileDiffStat,
  GitHistoryLoadInput,
  GitHistoryPage,
  GitOperationOutcome,
  GitOperationState,
  GitProjectInput,
  GitPullInput,
  GitPushInput,
  GitRefEntry,
  GitRemoteEntry,
  GitRemoteResult,
  GitStageInput,
  GitStashActionInput,
  GitStashEntry,
  GitStatusSummary,
  GitSwitchBranchInput,
  GitTagEntry,
  GitWorktreeEntry,
  Project,
} from '@space/contracts';
import { recordOperation, type StorageCaller } from './project-handlers';

export interface GitHandlersOptions {
  readonly gitExecutor?: GitExecutor;
  /** Directory HistoryStore's disk cache writes into; one JSON file per repository. */
  readonly historyCacheDir: string;
  /**
   * Fallback commit identity source (spec 11.6), tried only when the
   * machine has no global `git config user.name`/`user.email`: derives an
   * identity from the workspace's authenticated GitHub account rather than
   * failing the commit outright. Wired to `GithubHandlers.resolveFallbackIdentity`
   * in main.ts; optional so tests and any caller without GitHub wiring keep
   * today's "throw when unconfigured" behaviour.
   */
  readonly getFallbackIdentity?: (workspaceId: string) => Promise<GitIdentity | null>;
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
   * yet). When that's unset, falls back to the workspace's authenticated
   * GitHub account (`options.getFallbackIdentity`) rather than fabricating
   * one outright; only when neither source has an identity does this throw.
   * A repo-local override is still honored the same way plain `git commit`
   * would (spec 11.6 requires override to be an explicit acknowledged
   * action; there is no such UI step yet either, so a repo-local identity
   * is surfaced via `mismatch` but never silently substituted).
   */
  async function resolveIdentity(cwd: string, workspaceId: string): Promise<GitIdentity> {
    const [name, email] = await Promise.all([
      gitExecutor(configGetArgs('user.name', 'global'), { cwd }),
      gitExecutor(configGetArgs('user.email', 'global'), { cwd }),
    ]);
    let workspaceIdentity: GitIdentity;
    if (name.exitCode !== 0 || !name.stdout.trim() || email.exitCode !== 0 || !email.stdout.trim()) {
      const fallback = await options.getFallbackIdentity?.(workspaceId);
      if (!fallback) {
        throw new Error(
          'No Git author identity is configured (run "git config --global user.name" / "user.email" first)',
        );
      }
      workspaceIdentity = fallback;
    } else {
      workspaceIdentity = {
        name: name.stdout.trim(),
        email: email.stdout.trim(),
        signingPolicy: 'none',
        signingKeyId: null,
      };
    }
    const repoLocal = await readRepoLocalIdentity(cwd, gitExecutor);
    return resolveCommitIdentity({ workspaceIdentity, repoLocal, overrideAcknowledged: false }).identity;
  }

  /**
   * Real `git init` + stage-everything + one initial commit for a project
   * that was imported as a plain folder (spec: a project only counts as a
   * "real Git repository" once this has actually run — never inferred from
   * intent). Idempotent: a project that already has a repositoryRoot is
   * returned as-is. An empty working tree (nothing to stage, or everything
   * gitignored) is not an error — `git commit`'s "nothing to commit" exit
   * is the one commit failure this treats as benign; every other commit
   * failure (e.g. no Git author identity configured) still surfaces.
   */
  async function initRepo(input: GitProjectInput): Promise<Project> {
    const project = await requireProject(input.projectId);
    if (project.repositoryRoot) {
      return project;
    }
    const cwd = project.canonicalPath;
    return recordMutation(project, 'git.init', `Initialized Git for "${project.name}"`, async () => {
      await initRepository(cwd, 'main', gitExecutor);
      await stageFiles(cwd, ['.'], gitExecutor);
      try {
        const identity = await resolveIdentity(cwd, project.workspaceId);
        await runCommit(cwd, { identity, message: 'Initial commit' }, gitExecutor);
      } catch (error) {
        const isNothingToCommit = error instanceof CommitFailedError && /nothing to commit/i.test(error.message);
        if (!isNothingToCommit) {
          throw error;
        }
      }
      return storage.call<Project>('project.setRepositoryRoot', { projectId: project.id, repositoryRoot: cwd });
    });
  }

  async function commit(input: GitCommitInput): Promise<GitCommitResult> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    const firstLine = input.message.split('\n')[0];

    const outcome = await recordMutation(
      project,
      'git.commit',
      `Commit "${firstLine}"`,
      async () => {
        const identity = await resolveIdentity(cwd, project.workspaceId);
        const result: CommitOutcome = await queue.enqueueMutating(cwd, () =>
          runCommit(cwd, { identity, message: input.message }, gitExecutor),
        );
        return result;
      },
      (result) => result.sha,
    );
    invalidateHistory(project.id);
    return outcome;
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
    invalidateHistory(project.id);
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
    invalidateHistory(project.id);
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
    invalidateHistory(project.id);
  }

  async function mergeBranchHandler(input: GitMergeBranchInput): Promise<GitOperationOutcome> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    const outcome = await recordMutation(
      project,
      'git.branch.merge',
      `Merge "${input.branch}" into the current branch`,
      async () => {
        const full = await readFullStatus(cwd);
        const result = await queue.enqueueMutating(cwd, () =>
          mergeBranchEngine(
            cwd,
            full.gitDir,
            input.branch,
            { confirmed: input.confirmed, ...(input.noFf ? { noFf: true } : {}) },
            gitExecutor,
            gitDirFs,
          ),
        );
        return toGitOperationOutcome(result);
      },
      () => input.branch,
    );
    // Invalidate even on a conflicted (not-yet-completed) merge: HEAD hasn't
    // moved yet, but a stale cached page showing the wrong operation state
    // is worse than a harmless extra re-index once it does complete.
    invalidateHistory(project.id);
    return outcome;
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
    const outcome = await recordMutation(project, 'git.conflict.continue', `Continue "${project.name}"'s in-progress operation`, async () => {
      const full = await readFullStatus(cwd);
      const result = await queue.enqueueMutating(cwd, () =>
        continueOperation(cwd, full.gitDir, full.operationState, gitExecutor, gitDirFs),
      );
      return toGitOperationOutcome(result);
    });
    invalidateHistory(project.id);
    return outcome;
  }

  async function abortConflict(input: GitProjectInput): Promise<GitOperationOutcome> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    const outcome = await recordMutation(project, 'git.conflict.abort', `Abort "${project.name}"'s in-progress operation`, async () => {
      const full = await readFullStatus(cwd);
      const result = await queue.enqueueMutating(cwd, () =>
        abortOperation(cwd, full.gitDir, full.operationState, gitExecutor, gitDirFs),
      );
      return toGitOperationOutcome(result);
    });
    invalidateHistory(project.id);
    return outcome;
  }

  /** Read-only: both halves of `git diff --numstat`, so the UI can show real per-file added/removed counts. */
  async function diffStats(input: GitProjectInput): Promise<GitDiffStats> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    const [unstagedResult, stagedResult] = await Promise.all([
      gitExecutor(diffNumstatArgs(), { cwd }),
      gitExecutor(diffNumstatArgs({ cached: true }), { cwd }),
    ]);
    const toStats = (stdout: string, staged: boolean): GitFileDiffStat[] =>
      parseDiffNumstatOutput(stdout).map((entry) => ({ path: entry.path, added: entry.added, removed: entry.removed, staged }));
    return { files: [...toStats(unstagedResult.stdout, false), ...toStats(stagedResult.stdout, true)] };
  }

  /** Read-only: one file's real unified patch text on one side of the index. */
  async function diffFile(input: GitFileDiffInput): Promise<GitFileDiffResult> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    const result = await gitExecutor(diffPatchArgs({ cached: input.staged, paths: [input.path] }), { cwd });
    return { patchText: result.stdout };
  }

  /** Read-only: the repository's configured remotes and their fetch/push URLs (`git remote -v`). */
  async function listRemotes(input: GitProjectInput): Promise<readonly GitRemoteEntry[]> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    return listRemotesEngine(cwd, gitExecutor);
  }

  /** Read-only: the repository's stashes, newest first (`git stash list`). */
  async function listStashes(input: GitProjectInput): Promise<readonly GitStashEntry[]> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    return listStashesEngine(cwd, gitExecutor);
  }

  /** Read-only: the repository's tags with their peeled target, subject, and tagged date. */
  async function listTags(input: GitProjectInput): Promise<readonly GitTagEntry[]> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    return listTagsEngine(cwd, gitExecutor);
  }

  /**
   * Read-only: the repository's linked working trees. The repo toplevel is
   * `project.repositoryRoot` (what `repoCwd` returns), so it doubles as the
   * `currentRoot` the engine uses to flag exactly one entry `isCurrent`.
   */
  async function listWorktrees(input: GitProjectInput): Promise<readonly GitWorktreeEntry[]> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    return listWorktreesEngine(cwd, cwd, gitExecutor);
  }

  /**
   * `git stash apply` — a mutation of the worktree/index, so it runs through
   * the per-repository mutating lock and leaves a receipt. The engine's
   * `applyStash` does not throw when the apply leaves conflicts (it returns
   * `completed: false`); that is preserved here. A stash apply never resumes
   * a merge/rebase sequence, so `remaining` is always `{ kind: 'none' }` —
   * the wrapper only adapts `StashApplyOutcome` to `GitOperationOutcome`.
   */
  async function applyStash(input: GitStashActionInput): Promise<GitOperationOutcome> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    return recordMutation(project, 'git.stash.apply', `Apply stash@{${input.index}}`, async () => {
      const outcome = await queue.enqueueMutating(cwd, () => applyStashEngine(cwd, input.index, gitExecutor));
      const result: GitOperationOutcome = {
        completed: outcome.completed,
        remaining: { kind: 'none' },
        stdout: outcome.stdout,
        stderr: outcome.stderr,
      };
      return result;
    });
  }

  /**
   * `git stash drop` — destructive. The engine's `dropStash` does not enforce
   * the confirmation gate, so this handler rejects an unconfirmed drop before
   * touching the repository, mirroring deleteBranch's structural gate.
   */
  async function dropStash(input: GitStashActionInput): Promise<void> {
    if (input.confirmed !== true) {
      throw new Error('Dropping a stash is destructive and must be explicitly confirmed');
    }
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    await recordMutation(project, 'git.stash.drop', `Drop stash@{${input.index}}`, () =>
      queue.enqueueMutating(cwd, () => dropStashEngine(cwd, input.index, gitExecutor)),
    );
  }

  /**
   * Resolves one conflicted file by taking a whole side (`git checkout
   * --ours|--theirs` then `git add`) — a mutation of the worktree/index, so
   * it runs through the per-repository mutating lock and leaves a receipt.
   */
  async function resolveConflict(input: GitConflictResolveInput): Promise<void> {
    const project = await requireProject(input.projectId);
    const cwd = repoCwd(project);
    await recordMutation(project, 'git.conflict.resolve', `Resolve "${input.path}" using ${input.side}`, () =>
      queue.enqueueMutating(cwd, () => resolveConflictEngine(cwd, input.path, input.side, gitExecutor)),
    );
  }

  return {
    status,
    initRepo,
    stage,
    unstage,
    commit,
    listBranches,
    createBranch: createBranchHandler,
    switchBranch: switchBranchHandler,
    deleteBranch: deleteBranchHandler,
    mergeBranch: mergeBranchHandler,
    loadHistory,
    invalidateHistory,
    fetch,
    pull,
    push,
    conflictState,
    continueConflict,
    abortConflict,
    diffStats,
    diffFile,
    listRemotes,
    listStashes,
    listTags,
    listWorktrees,
    applyStash,
    dropStash,
    resolveConflict,
  };
}

export type GitHandlers = ReturnType<typeof createGitHandlers>;
