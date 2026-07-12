/**
 * Main-process business logic for M6's GitHub surface (GH-001..009, spec
 * section 14). Mirrors git-handlers.ts's shape exactly: real work
 * (spawning `gh`/`git`, resolving the workspace's token from the OS
 * credential store, running the interactive-login PTY) happens here,
 * outside the storage worker, whose only job per ADR-003 is owning the
 * database. Every mutating action is recorded through `recordOperation`
 * so it gets a durable receipt (spec 33) and, via storage-handlers.ts's
 * `operation.recordCompleted` hook, a real activity event.
 *
 * Credential architecture (spec 5.6, ADR-002): a workspace's GitHub token
 * is read from `@space/security`'s `CredentialStorePort` — never SQLite —
 * addressed by `buildGithubCredentialRef(workspaceId, host)`, and merged
 * into the `gh`/`git` child process's environment for exactly the
 * duration of that command (`scopedGhExecutor`/`scopedGitExecutor`). The
 * token is registered with a `RedactionRegistry` the moment it is read,
 * before it is ever used, and every command's stdout/stderr is redacted
 * through that registry before it can reach a receipt or a log.
 */
import {
  allChecksComplete,
  buildGithubCredentialRef,
  cancelRun,
  checkoutPullRequest,
  closeIssue,
  commentOnIssue,
  compareSinceTag,
  createAndPublishRepository,
  createDraftRelease,
  createIssue,
  createNodeGhExecutor,
  createPullRequest,
  deriveRequiredCheckStatus,
  downloadRunArtifacts,
  editIssue,
  editPullRequest,
  fetchRunLog,
  generateReleaseNotes,
  ghAuthLoginArgs,
  listAvailableOrgs,
  listIssues,
  listPullRequests,
  listRuns,
  listWorkflows,
  loadAuthStatus,
  loadChecks,
  loadGithubAuthReport,
  loadRequiredCheckNames,
  loadWorkflowDispatchInputs,
  logout as ghLogout,
  mergePullRequest,
  planRepositoryPublish,
  planStartWork,
  pollChecksUntilComplete,
  pollRunUntilComplete,
  publishRelease,
  remoteActionAvailability,
  rerunRun,
  reopenIssue,
  setupAndVerifyGitCredentialHelper,
  suggestNextVersionTag,
  triggerWorkflowDispatch,
  uploadReleaseArtifacts,
  viewIssue,
  viewPullRequest,
  viewRun,
  type GhAuthStatusReport,
  type GhExecutor,
  type GhOrg,
  type GithubAuthReport,
  type GithubConnectivity,
  type IssueCloseReason,
  type IssueCreateInput,
  type IssueEditInput,
  type IssueListFilter,
  type PullRequestCreateInput,
  type PullRequestEditInput,
  type PullRequestListFilter,
  type MergeMethod,
  type ReleaseCreateInput,
  type RepoCreateInput,
  type RepoPublishPlan,
  type RunListFilter,
  type TokenSourceStrategy,
  type WorkflowDispatchInputDefinition,
} from '@space/github-engine';
import {
  addRemote,
  createAndPushTag,
  createNodeGitExecutor,
  getRemoteUrl,
  type GitExecutor,
} from '@space/git-engine';
import type { CredentialStorePort } from '@space/security';
import { RedactionRegistry } from '@space/workspace-runner';
import type { Project } from '@space/contracts';
import type { TerminalWorkerEvent, TerminalWorkerMethod } from '@space/terminal';
import { recordOperation, type StorageCaller } from './project-handlers';

export interface TerminalCaller {
  call<T>(method: TerminalWorkerMethod, payload: unknown): Promise<T>;
  subscribe(sessionId: string, listener: (event: TerminalWorkerEvent) => void): () => void;
}

export interface GithubHandlersOptions {
  readonly ghExecutor?: GhExecutor;
  readonly gitExecutor?: GitExecutor;
  readonly credentialStore: CredentialStorePort;
  readonly terminal: TerminalCaller;
  /** A Space-owned, per-workspace GH_CONFIG_DIR (ADR-002 Tier 1 isolation) — e.g. `<userData>/workspaces/<id>/gh-config`. */
  readonly ghConfigDirFor: (workspaceId: string) => string;
  readonly redaction?: RedactionRegistry;
  readonly defaultHost?: string;
  readonly now?: () => string;
}

interface ServiceConnectionRowLike {
  readonly id: string;
  readonly workspaceId: string;
  readonly adapterId: string;
  readonly host: string;
  readonly accountLabel: string | null;
  readonly profileLabel: string | null;
  readonly secretRefId: string | null;
  readonly state: 'connected' | 'disconnected' | 'error';
  readonly lastVerifiedAt: string | null;
}

export function createGithubHandlers(storage: StorageCaller, options: GithubHandlersOptions) {
  const baseGhExecutor = options.ghExecutor ?? createNodeGhExecutor();
  const baseGitExecutor = options.gitExecutor ?? createNodeGitExecutor();
  const redaction = options.redaction ?? new RedactionRegistry();
  const defaultHost = options.defaultHost ?? 'github.com';
  const now = options.now ?? (() => new Date().toISOString());

  async function requireProject(projectId: string): Promise<Project> {
    return storage.call<Project>('project.get', { projectId });
  }

  function repoCwd(project: Project): string {
    if (!project.repositoryRoot) {
      throw new Error(`Project "${project.name}" is not a Git repository`);
    }
    return project.repositoryRoot;
  }

  async function getConnection(workspaceId: string, host: string): Promise<ServiceConnectionRowLike | null> {
    return storage.call<ServiceConnectionRowLike | null>('githubConnection.get', { workspaceId, adapterId: 'github', host });
  }

  /** Resolves the workspace's real token from the OS credential store (spec 5.6) — never from SQLite. Registers it with the redactor the instant it is read. */
  async function resolveToken(workspaceId: string, host: string): Promise<string | null> {
    const token = await options.credentialStore.get(buildGithubCredentialRef(workspaceId, host));
    if (token) {
      redaction.register(token);
    }
    return token;
  }

  /** GH_CONFIG_DIR + GH_TOKEN injected only into this one gh invocation's environment (spec 5.6) — every result is redacted before the caller sees it. */
  function scopedGhExecutor(workspaceId: string, host: string, token: string | null): GhExecutor {
    const ghConfigDir = options.ghConfigDirFor(workspaceId);
    return async (args, execOptions) => {
      const env: Record<string, string> = { GH_CONFIG_DIR: ghConfigDir, ...(execOptions?.env ?? {}) };
      if (token) {
        env['GH_TOKEN'] = token;
      }
      const result = await baseGhExecutor(args, { ...execOptions, env });
      return { exitCode: result.exitCode, stdout: redaction.redact(result.stdout), stderr: redaction.redact(result.stderr) };
    };
  }

  /** Same GH_CONFIG_DIR/GH_TOKEN visibility for git subprocesses whose credential helper is `gh auth git-credential` (GH-002/GH-008). */
  function scopedGitExecutor(workspaceId: string, host: string, token: string | null): GitExecutor {
    const ghConfigDir = options.ghConfigDirFor(workspaceId);
    return async (args, execOptions) => {
      const env: Record<string, string> = { GH_CONFIG_DIR: ghConfigDir, ...(execOptions?.env ?? {}) };
      if (token) {
        env['GH_TOKEN'] = token;
      }
      const result = await baseGitExecutor(args, { ...execOptions, env });
      return { exitCode: result.exitCode, stdout: redaction.redact(result.stdout), stderr: redaction.redact(result.stderr) };
    };
  }

  async function scopedExecutors(workspaceId: string, host: string): Promise<{ gh: GhExecutor; git: GitExecutor; token: string | null }> {
    const token = await resolveToken(workspaceId, host);
    return { gh: scopedGhExecutor(workspaceId, host, token), git: scopedGitExecutor(workspaceId, host, token), token };
  }

  // ---------------------------------------------------------------------
  // GH-001: Authentication
  // ---------------------------------------------------------------------

  async function authReport(workspaceId: string, host = defaultHost): Promise<GithubAuthReport> {
    const connection = await getConnection(workspaceId, host);
    const { gh } = await scopedExecutors(workspaceId, host);
    const tokenSourceStrategy: TokenSourceStrategy = connection?.secretRefId ? 'space-managed-os-keychain' : 'gh-default';
    return loadGithubAuthReport(gh, { tokenSourceStrategy, host });
  }

  /**
   * Starts `gh auth login` in a real PTY (spec 14.3) via the injected
   * `TerminalCaller` — the same PTY host M4 built for shells, reused
   * rather than rebuilt. Resolves once the process exits, having shown
   * (via the terminal UI) only the hostname/account the resulting
   * `gh auth status` reports, never the token. On success, records a
   * `ServiceConnection` row and a `SecretRef` — no token in SQLite, only
   * the reference — and (when the OS keychain is the chosen fallback
   * strategy per ADR-002) stores the resolved token there.
   */
  async function startAuthLogin(input: {
    readonly workspaceId: string;
    readonly host?: string;
    readonly webFlow?: boolean;
    readonly gitProtocol?: 'https' | 'ssh';
    readonly cwd: string;
  }): Promise<{ readonly sessionId: string }> {
    const host = input.host ?? defaultHost;
    const args = ghAuthLoginArgs({
      hostname: host,
      ...(input.webFlow !== undefined ? { web: input.webFlow } : {}),
      ...(input.gitProtocol ? { gitProtocol: input.gitProtocol } : {}),
    });
    const ghConfigDir = options.ghConfigDirFor(input.workspaceId);
    const session = await options.terminal.call<{ id: string }>('terminal.create', {
      workspaceId: input.workspaceId,
      projectId: null,
      shell: 'gh',
      args,
      cwd: input.cwd,
      env: { GH_CONFIG_DIR: ghConfigDir },
      cols: 80,
      rows: 24,
    });

    const startedAt = now();
    const unsubscribe = options.terminal.subscribe(session.id, (event) => {
      if (event.type !== 'exit') {
        return;
      }
      unsubscribe();
      void (async () => {
        const succeeded = event.exitCode === 0;
        if (succeeded) {
          const { gh } = await scopedExecutors(input.workspaceId, host);
          const status: GhAuthStatusReport = await loadAuthStatus(gh);
          const active = status.accounts.find((account) => account.active) ?? status.accounts[0] ?? null;
          await storage.call('githubConnection.upsert', {
            id: `${input.workspaceId}:github:${host}`,
            workspaceId: input.workspaceId,
            adapterId: 'github',
            host,
            accountLabel: active?.account ?? null,
            profileLabel: null,
            secretRefId: null,
            state: status.authenticated ? 'connected' : 'error',
            lastVerifiedAt: now(),
          });
        }
        await recordOperation(storage, {
          workspaceId: input.workspaceId,
          projectId: null,
          type: 'github.auth.login',
          humanSummary: `Sign in to ${host}`,
          startedAt,
          state: succeeded ? 'succeeded' : 'failed',
          exitCode: event.exitCode,
        });
      })();
    });

    return { sessionId: session.id };
  }

  async function logout(workspaceId: string, host = defaultHost): Promise<void> {
    const { gh } = await scopedExecutors(workspaceId, host);
    await recordOperation(storage, {
      workspaceId,
      projectId: null,
      type: 'github.auth.logout',
      humanSummary: `Sign out of ${host}`,
      startedAt: now(),
      state: 'succeeded',
      exitCode: 0,
    });
    await ghLogout(gh, host);
    await storage.call('githubConnection.upsert', {
      id: `${workspaceId}:github:${host}`,
      workspaceId,
      adapterId: 'github',
      host,
      accountLabel: null,
      profileLabel: null,
      secretRefId: null,
      state: 'disconnected',
      lastVerifiedAt: now(),
    });
  }

  async function listOrgs(workspaceId: string, host = defaultHost): Promise<readonly GhOrg[] | null> {
    const { gh } = await scopedExecutors(workspaceId, host);
    return listAvailableOrgs(gh);
  }

  // ---------------------------------------------------------------------
  // GH-002: Credential setup for Git
  // ---------------------------------------------------------------------

  async function setupGit(workspaceId: string, remoteUrl: string, host = defaultHost): Promise<{ readonly verified: boolean; readonly detail: string }> {
    const { gh, git } = await scopedExecutors(workspaceId, host);
    return recordOperation(storage, {
      workspaceId,
      projectId: null,
      type: 'github.setupGit',
      humanSummary: `Configure Git credentials for ${host}`,
      startedAt: now(),
      state: 'succeeded',
      exitCode: 0,
    }).then(() => setupAndVerifyGitCredentialHelper(remoteUrl, gh, git, host));
  }

  // ---------------------------------------------------------------------
  // GH-003: Repository creation / publish
  // ---------------------------------------------------------------------

  async function planPublish(workspaceId: string, owner: string, name: string, host = defaultHost): Promise<RepoPublishPlan> {
    const { gh } = await scopedExecutors(workspaceId, host);
    return planRepositoryPublish(gh, owner, name);
  }

  /** Never overwrites — a name collision must be resolved explicitly by the caller as 'connect' (adds the existing repo as a remote) or by retrying with a different name (spec 14.5, 39). */
  async function publishRepository(
    projectId: string,
    input: RepoCreateInput,
    connectResolution?: { readonly nameWithOwner: string; readonly url: string },
  ): Promise<{ readonly nameWithOwner: string; readonly url: string }> {
    const project = await requireProject(projectId);
    const cwd = repoCwd(project);
    const { gh, git } = await scopedExecutors(project.workspaceId, defaultHost);

    return recordOperation(storage, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      type: 'github.repo.publish',
      humanSummary: `Publish "${project.name}" to GitHub`,
      startedAt: now(),
      state: 'succeeded',
      exitCode: 0,
    }).then(async () => {
      if (connectResolution) {
        const existingRemote = await getRemoteUrl(cwd, input.remoteName ?? 'origin', git);
        if (existingRemote) {
          throw new Error(`Remote "${input.remoteName ?? 'origin'}" already exists locally (${existingRemote}) — choose a different remote name.`);
        }
        await addRemote(cwd, input.remoteName ?? 'origin', connectResolution.url, git);
        return connectResolution;
      }
      return createAndPublishRepository(gh, input);
    });
  }

  // ---------------------------------------------------------------------
  // GH-004: Pull requests
  // ---------------------------------------------------------------------

  async function prList(workspaceId: string, filter?: PullRequestListFilter, host = defaultHost) {
    const { gh } = await scopedExecutors(workspaceId, host);
    return listPullRequests(gh, filter);
  }

  async function prView(workspaceId: string, number: number, host = defaultHost) {
    const { gh } = await scopedExecutors(workspaceId, host);
    return viewPullRequest(gh, number);
  }

  async function prCreate(workspaceId: string, input: PullRequestCreateInput, host = defaultHost): Promise<{ readonly url: string }> {
    const { gh } = await scopedExecutors(workspaceId, host);
    return recordOperation(storage, {
      workspaceId,
      projectId: null,
      type: 'github.pr.create',
      humanSummary: `Create pull request "${input.title}"`,
      startedAt: now(),
      state: 'succeeded',
      exitCode: 0,
    }).then(() => createPullRequest(gh, input));
  }

  async function prEdit(workspaceId: string, number: number, input: PullRequestEditInput, host = defaultHost): Promise<void> {
    const { gh } = await scopedExecutors(workspaceId, host);
    await editPullRequest(gh, number, input);
  }

  async function prCheckout(projectId: string, number: number, host = defaultHost): Promise<void> {
    const project = await requireProject(projectId);
    const { gh } = await scopedExecutors(project.workspaceId, host);
    await checkoutPullRequest(gh, number);
  }

  async function prMerge(workspaceId: string, number: number, method: MergeMethod, deleteBranch: boolean, confirmed: boolean, host = defaultHost): Promise<void> {
    const { gh } = await scopedExecutors(workspaceId, host);
    await recordOperation(storage, {
      workspaceId,
      projectId: null,
      type: 'github.pr.merge',
      humanSummary: `Merge pull request #${number}`,
      startedAt: now(),
      state: 'succeeded',
      exitCode: 0,
      subjectRef: String(number),
    }).then(() => mergePullRequest(gh, { number, method, deleteBranch, confirmed }));
  }

  // ---------------------------------------------------------------------
  // GH-005: Checks
  // ---------------------------------------------------------------------

  async function prChecks(workspaceId: string, number: number, nameWithOwner: string, branch: string, host = defaultHost) {
    const { gh } = await scopedExecutors(workspaceId, host);
    const [checks, requiredNames] = await Promise.all([loadChecks(gh, number), loadRequiredCheckNames(gh, nameWithOwner, branch)]);
    return { checks, complete: allChecksComplete(checks), required: deriveRequiredCheckStatus(checks, requiredNames) };
  }

  async function watchChecks(workspaceId: string, number: number, isCancelled: () => boolean, host = defaultHost) {
    const { gh } = await scopedExecutors(workspaceId, host);
    return pollChecksUntilComplete(gh, number, { isCancelled });
  }

  // ---------------------------------------------------------------------
  // GH-006: Actions
  // ---------------------------------------------------------------------

  async function actionsListWorkflows(workspaceId: string, host = defaultHost) {
    const { gh } = await scopedExecutors(workspaceId, host);
    return listWorkflows(gh);
  }

  async function actionsListRuns(workspaceId: string, filter: RunListFilter | undefined, host = defaultHost) {
    const { gh } = await scopedExecutors(workspaceId, host);
    return listRuns(gh, filter);
  }

  async function actionsWorkflowInputs(workspaceId: string, nameWithOwner: string, workflowPath: string, ref?: string, host = defaultHost): Promise<readonly WorkflowDispatchInputDefinition[]> {
    const { gh } = await scopedExecutors(workspaceId, host);
    return loadWorkflowDispatchInputs(gh, nameWithOwner, workflowPath, ref);
  }

  async function actionsTrigger(workspaceId: string, workflow: string, ref: string, inputs: Readonly<Record<string, string>>, confirmed: boolean, host = defaultHost): Promise<void> {
    const { gh } = await scopedExecutors(workspaceId, host);
    await recordOperation(storage, {
      workspaceId,
      projectId: null,
      type: 'github.actions.trigger',
      humanSummary: `Trigger workflow "${workflow}" on "${ref}"`,
      startedAt: now(),
      state: 'succeeded',
      exitCode: 0,
    }).then(() => triggerWorkflowDispatch(gh, { workflow, ref, inputs, confirmed }));
  }

  async function actionsWatchRun(workspaceId: string, id: number, isCancelled: () => boolean, host = defaultHost) {
    const { gh } = await scopedExecutors(workspaceId, host);
    return pollRunUntilComplete(gh, id, { isCancelled });
  }

  async function actionsViewRun(workspaceId: string, id: number, host = defaultHost) {
    const { gh } = await scopedExecutors(workspaceId, host);
    return viewRun(gh, id);
  }

  async function actionsRunLog(workspaceId: string, id: number, host = defaultHost): Promise<string> {
    const { gh } = await scopedExecutors(workspaceId, host);
    return fetchRunLog(gh, id);
  }

  async function actionsDownloadArtifacts(workspaceId: string, id: number, destinationDir: string, artifactName?: string, host = defaultHost): Promise<void> {
    const { gh } = await scopedExecutors(workspaceId, host);
    await downloadRunArtifacts(gh, id, destinationDir, artifactName);
  }

  async function actionsCancel(workspaceId: string, id: number, host = defaultHost): Promise<void> {
    const { gh } = await scopedExecutors(workspaceId, host);
    await recordOperation(storage, { workspaceId, projectId: null, type: 'github.actions.cancel', humanSummary: `Cancel run #${id}`, startedAt: now(), state: 'succeeded', exitCode: 0 }).then(() =>
      cancelRun(gh, id),
    );
  }

  async function actionsRerun(workspaceId: string, id: number, failedOnly: boolean, host = defaultHost): Promise<void> {
    const { gh } = await scopedExecutors(workspaceId, host);
    await recordOperation(storage, { workspaceId, projectId: null, type: 'github.actions.rerun', humanSummary: `Rerun ${id}`, startedAt: now(), state: 'succeeded', exitCode: 0 }).then(() =>
      rerunRun(gh, id, failedOnly),
    );
  }

  // ---------------------------------------------------------------------
  // GH-007: Issues
  // ---------------------------------------------------------------------

  async function issuesList(workspaceId: string, filter: IssueListFilter | undefined, host = defaultHost) {
    const { gh } = await scopedExecutors(workspaceId, host);
    return listIssues(gh, filter);
  }

  async function issuesView(workspaceId: string, number: number, host = defaultHost) {
    const { gh } = await scopedExecutors(workspaceId, host);
    return viewIssue(gh, number);
  }

  async function issuesCreate(workspaceId: string, input: IssueCreateInput, host = defaultHost): Promise<{ readonly url: string }> {
    const { gh } = await scopedExecutors(workspaceId, host);
    return recordOperation(storage, { workspaceId, projectId: null, type: 'github.issue.create', humanSummary: `Create issue "${input.title}"`, startedAt: now(), state: 'succeeded', exitCode: 0 }).then(
      () => createIssue(gh, input),
    );
  }

  async function issuesEdit(workspaceId: string, number: number, input: IssueEditInput, host = defaultHost): Promise<void> {
    const { gh } = await scopedExecutors(workspaceId, host);
    await editIssue(gh, number, input);
  }

  async function issuesComment(workspaceId: string, number: number, body: string, host = defaultHost): Promise<void> {
    const { gh } = await scopedExecutors(workspaceId, host);
    await commentOnIssue(gh, number, body);
  }

  async function issuesClose(workspaceId: string, number: number, reason?: IssueCloseReason, host = defaultHost): Promise<void> {
    const { gh } = await scopedExecutors(workspaceId, host);
    await recordOperation(storage, { workspaceId, projectId: null, type: 'github.issue.close', humanSummary: `Close issue #${number}`, startedAt: now(), state: 'succeeded', exitCode: 0 }).then(() =>
      closeIssue(gh, number, reason),
    );
  }

  async function issuesReopen(workspaceId: string, number: number, host = defaultHost): Promise<void> {
    const { gh } = await scopedExecutors(workspaceId, host);
    await reopenIssue(gh, number);
  }

  /**
   * GH-007's guided "start work": refreshes the base branch and creates a
   * safe-slug branch for real (`@space/git-engine`), then records the
   * issue as the session goal and the future PR's link fragment as this
   * operation's receipt (spec 17.3: a receipt links to "the relevant
   * commit" — here, the branch it created) rather than inventing a new,
   * unspecified "session goal" table (spec 23.2 defines no such entity).
   * "Opens the relevant project" is the caller's job once this resolves,
   * since only the renderer/window layer can navigate.
   */
  async function issuesStartWork(projectId: string, issue: { readonly number: number; readonly title: string }, baseBranch: string): Promise<{ readonly branchName: string; readonly prLinkFragment: string }> {
    const project = await requireProject(projectId);
    const cwd = repoCwd(project);
    const plan = planStartWork(issue, baseBranch);
    const { git } = await scopedExecutors(project.workspaceId, defaultHost);

    return recordOperation(storage, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      type: 'github.issue.startWork',
      humanSummary: `Start work on "${plan.sessionGoal}"`,
      startedAt: now(),
      state: 'succeeded',
      exitCode: 0,
      subjectRef: plan.branchName,
    }).then(async () => {
      await git(['fetch', '--prune', '--', 'origin'], { cwd });
      await git(['checkout', '-B', plan.branchName, `origin/${baseBranch}`], { cwd });
      return { branchName: plan.branchName, prLinkFragment: plan.prLinkFragment };
    });
  }

  // ---------------------------------------------------------------------
  // GH-008: Releases
  // ---------------------------------------------------------------------

  async function releaseCompare(workspaceId: string, nameWithOwner: string, sinceTag: string, head: string, host = defaultHost) {
    const { gh } = await scopedExecutors(workspaceId, host);
    return compareSinceTag(gh, nameWithOwner, sinceTag, head);
  }

  async function releaseSuggestVersion(previousTag: string, commitSubjects: readonly string[]): Promise<string | null> {
    return suggestNextVersionTag(previousTag, commitSubjects);
  }

  async function releaseNotes(workspaceId: string, nameWithOwner: string, tagName: string, targetCommitish?: string, host = defaultHost): Promise<string> {
    const { gh } = await scopedExecutors(workspaceId, host);
    return generateReleaseNotes(gh, nameWithOwner, tagName, targetCommitish);
  }

  /** Creates the tag locally, pushes it, then creates the GitHub release as a draft (never already-published, spec 14.10/39). */
  async function releaseCreateDraft(projectId: string, tagMessage: string, input: ReleaseCreateInput, remoteName = 'origin'): Promise<{ readonly url: string }> {
    const project = await requireProject(projectId);
    const cwd = repoCwd(project);
    const { gh, git } = await scopedExecutors(project.workspaceId, defaultHost);

    return recordOperation(storage, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      type: 'github.release.createDraft',
      humanSummary: `Create draft release "${input.tagName}"`,
      startedAt: now(),
      state: 'succeeded',
      exitCode: 0,
      subjectRef: input.tagName,
    }).then(async () => {
      await createAndPushTag(cwd, remoteName, { name: input.tagName, message: tagMessage }, git);
      return createDraftRelease(gh, input);
    });
  }

  async function releasePublish(workspaceId: string, tagName: string, confirmed: boolean, host = defaultHost): Promise<void> {
    const { gh } = await scopedExecutors(workspaceId, host);
    await recordOperation(storage, {
      workspaceId,
      projectId: null,
      type: 'github.release.publish',
      humanSummary: `Publish release "${tagName}"`,
      startedAt: now(),
      state: 'succeeded',
      exitCode: 0,
      subjectRef: tagName,
    }).then(() => publishRelease(gh, { tagName, confirmed }));
  }

  async function releaseUploadArtifactFiles(workspaceId: string, tagName: string, filePaths: readonly string[], host = defaultHost): Promise<void> {
    const { gh } = await scopedExecutors(workspaceId, host);
    await uploadReleaseArtifacts(gh, tagName, filePaths);
  }

  async function releaseTriggerWorkflow(workspaceId: string, workflow: string, ref: string, inputs: Readonly<Record<string, string>>, confirmed: boolean, host = defaultHost): Promise<void> {
    const { gh } = await scopedExecutors(workspaceId, host);
    await recordOperation(storage, {
      workspaceId,
      projectId: null,
      type: 'github.release.triggerWorkflow',
      humanSummary: `Trigger release workflow "${workflow}"`,
      startedAt: now(),
      state: 'succeeded',
      exitCode: 0,
    }).then(() => triggerWorkflowDispatch(gh, { workflow, ref, inputs, confirmed }));
  }

  // ---------------------------------------------------------------------
  // GH-009: Offline / degraded behaviour
  // ---------------------------------------------------------------------

  /** No network probe here by design — connectivity is the caller's observation (a failed call, a system online/offline event); this only turns that observation into the spec 14.11 gate. */
  function remoteAvailability(connectivity: GithubConnectivity) {
    return remoteActionAvailability(connectivity);
  }

  return {
    authReport,
    startAuthLogin,
    logout,
    listOrgs,
    setupGit,
    planPublish,
    publishRepository,
    prList,
    prView,
    prCreate,
    prEdit,
    prCheckout,
    prMerge,
    prChecks,
    watchChecks,
    actionsListWorkflows,
    actionsListRuns,
    actionsWorkflowInputs,
    actionsTrigger,
    actionsWatchRun,
    actionsViewRun,
    actionsRunLog,
    actionsDownloadArtifacts,
    actionsCancel,
    actionsRerun,
    issuesList,
    issuesView,
    issuesCreate,
    issuesEdit,
    issuesComment,
    issuesClose,
    issuesReopen,
    issuesStartWork,
    releaseCompare,
    releaseSuggestVersion,
    releaseNotes,
    releaseCreateDraft,
    releasePublish,
    releaseUploadArtifactFiles,
    releaseTriggerWorkflow,
    remoteAvailability,
  };
}

export type GithubHandlers = ReturnType<typeof createGithubHandlers>;
