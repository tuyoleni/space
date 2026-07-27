/**
 * Pre-flight checks and one-click fixes for the conditions that otherwise
 * surface as raw Git output.
 *
 * The problem this solves: clicking Push on a project with no remote gave
 * the user `fatal: 'origin' does not appear to be a git repository`. That
 * is the real CLI's real message, and Space's job is to orchestrate the
 * real CLI — but handing its stderr straight to someone who has never
 * configured a remote is the exact friction Space exists to remove.
 *
 * Two deliberate choices:
 *
 *  - **Preconditions, not error translation.** "There is no remote" is
 *    knowable from state Space already holds, before `git push` is invoked.
 *    Checking first is deterministic, instant, offline, and needs no API
 *    key. Interpreting stderr after the fact is none of those things. A
 *    model belongs on genuinely unrecognised failures, not on a condition
 *    with one cause and one remedy.
 *
 *  - **No new capabilities.** Every remedy dispatches into the same
 *    gitHandlers/githubHandlers/environmentHandlers the rest of the app
 *    uses, so a fix applied from a dialog is the identical operation, with
 *    the identical receipt and trust gate, as doing it by hand.
 */
import {
  blockingIssueFor,
  diagnoseProjectReadiness,
  type ProjectAction,
  type ProjectReadinessSnapshot,
} from '@space/domain';
import type {
  GitRemoteEntry,
  GitStatusSummary,
  GithubAuthReport,
  Project,
  ProjectApplyRemedyInput,
  ProjectApplyRemedyResult,
  ProjectDiagnoseInput,
  ProjectDiagnosis,
} from '@space/contracts';
import type { GitHandlers } from './git-handlers';
import type { GithubHandlers } from './github-handlers';
import type { EnvironmentHandlers } from './environment-handlers';
import type { StorageCaller } from './project-handlers';

export interface ProjectReadinessDeps {
  readonly gitHandlers: GitHandlers;
  readonly githubHandlers: GithubHandlers;
  readonly environmentHandlers: EnvironmentHandlers;
}

/** A GitHub repository name derived from a project name, or null when nothing usable survives. */
export function repositoryNameFor(projectName: string): string | null {
  const slug = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return slug.length > 0 ? slug : null;
}

export function createProjectReadinessHandlers(storage: StorageCaller, deps: ProjectReadinessDeps) {
  const { gitHandlers, githubHandlers, environmentHandlers } = deps;

  async function requireProject(projectId: string): Promise<Project> {
    return storage.call<Project>('project.get', { projectId });
  }

  /**
   * Reads the real state behind every check. Each probe is independently
   * failure-tolerant: a project with no repository makes `git status` throw,
   * and that is an answer, not an error to propagate.
   */
  async function snapshot(project: Project): Promise<ProjectReadinessSnapshot> {
    const hasRepository = project.repositoryRoot !== null;

    const [status, remotes, auth] = await Promise.all([
      hasRepository
        ? gitHandlers.status({ projectId: project.id }).catch(() => null)
        : Promise.resolve(null),
      hasRepository
        ? gitHandlers.listRemotes({ projectId: project.id }).catch(() => [] as GitRemoteEntry[])
        : Promise.resolve([] as GitRemoteEntry[]),
      githubHandlers.authReport(project.workspaceId).catch(() => null),
    ]);

    return {
      projectName: project.name,
      hasRepository,
      hasCommits: await hasAnyCommit(project, status),
      remoteNames: remotes.map((remote) => remote.name),
      currentBranch: status?.branch.detached ? null : status?.branch.branchName ?? null,
      upstream: status?.branch.upstream ?? null,
      githubCliInstalled: (auth as GithubAuthReport | null)?.cliInstalled ?? false,
      githubAuthenticated: (auth as GithubAuthReport | null)?.authenticated ?? false,
      githubAccount: (auth as GithubAuthReport | null)?.activeAccount?.account ?? null,
    };
  }

  /**
   * A repository with no commits still reports a branch, so branch presence
   * proves nothing. Asking the history for a single entry is the cheapest
   * honest answer.
   */
  async function hasAnyCommit(project: Project, status: GitStatusSummary | null): Promise<boolean> {
    if (project.repositoryRoot === null || status === null) {
      return false;
    }
    const page = await gitHandlers
      .loadHistory({ projectId: project.id, offset: 0, count: 1 })
      .catch(() => null);
    return (page?.commits.length ?? 0) > 0;
  }

  async function diagnose(input: ProjectDiagnoseInput): Promise<ProjectDiagnosis> {
    const project = await requireProject(input.projectId);
    const issues = diagnoseProjectReadiness(await snapshot(project));
    return {
      issues,
      blocking: input.action ? blockingIssueFor(input.action as ProjectAction, issues) : null,
    };
  }

  /**
   * Carries out one remedy, then re-diagnoses so the caller sees the state
   * its own fix produced rather than trusting that it worked.
   */
  async function applyRemedy(input: ProjectApplyRemedyInput): Promise<ProjectApplyRemedyResult> {
    const project = await requireProject(input.projectId);
    const message = await runRemedy(project, input);
    return {
      applied: true,
      message,
      diagnosis: await diagnose({ projectId: input.projectId }),
    };
  }

  async function runRemedy(project: Project, input: ProjectApplyRemedyInput): Promise<string> {
    switch (input.remedyId) {
      case 'initialize-repository': {
        await gitHandlers.initRepo({ projectId: project.id });
        return 'Set up version history and saved a first snapshot.';
      }

      case 'create-initial-commit': {
        if (project.repositoryRoot === null) {
          // The project changed underneath the open dialog. Let the
          // initialization path repair both missing preconditions.
          await gitHandlers.initRepo({ projectId: project.id });
        } else {
          // `initRepo` is intentionally a no-op once repositoryRoot exists.
          // This remedy is specifically for the other state: Git exists but
          // has no commits. Use the real staging and commit handlers so the
          // operation receives the normal trust, identity, receipt, queue,
          // and error handling instead of falsely reporting an init no-op as
          // a saved snapshot.
          await gitHandlers.stage({ projectId: project.id, paths: ['.'] });
          await gitHandlers.commit({ projectId: project.id, message: 'Initial commit' });
        }
        return 'Saved the first snapshot.';
      }

      case 'publish-to-github': {
        const name = repositoryNameFor(project.name);
        if (name === null) {
          throw new Error(`Could not derive a repository name from "${project.name}" — choose one manually.`);
        }
        const owner = input.owner ?? (await resolveDefaultOwner(project));
        const published = await githubHandlers.publishRepository(project.id, {
          owner,
          name,
          visibility: input.visibility ?? 'private',
          sourceFolder: project.repositoryRoot ?? project.canonicalPath,
          push: true,
        });
        return `Created ${published.nameWithOwner} and uploaded your work.`;
      }

      case 'add-existing-remote': {
        const remoteUrl = input.remoteUrl?.trim();
        if (!remoteUrl) {
          throw new Error('Enter the address of the existing repository first.');
        }
        await gitHandlers.addRemote({ projectId: project.id, name: 'origin', url: remoteUrl });
        return `Linked this project to ${remoteUrl}.`;
      }

      case 'push-and-set-upstream': {
        const status = await gitHandlers.status({ projectId: project.id });
        const branch = status.branch.branchName;
        if (!branch || status.branch.detached) {
          throw new Error('This project is not on a branch, so there is nothing to publish yet.');
        }
        await gitHandlers.push({ projectId: project.id, branch, setUpstream: true });
        return `Published "${branch}".`;
      }

      case 'install-github-cli': {
        const result = await environmentHandlers.installTool({ toolId: 'gh' });
        if (!result.succeeded) {
          throw new Error(result.message ?? 'The GitHub tool could not be installed.');
        }
        return 'Installed GitHub support. Sign in next to publish.';
      }

      case 'sign-in-to-github': {
        // Hands off to the real interactive `gh auth login` PTY the GitHub
        // panel already drives; completion happens in the browser, so this
        // reports the handoff rather than claiming success.
        await githubHandlers.startAuthLogin({
          workspaceId: project.workspaceId,
          webFlow: true,
          cwd: project.repositoryRoot ?? project.canonicalPath,
        });
        return 'Opened GitHub sign-in. Finish in your browser, then try again.';
      }

      default: {
        // Exhaustiveness: a new remedy id must be handled, not silently ignored.
        const unreachable: never = input.remedyId;
        throw new Error(`Unhandled remedy: ${String(unreachable)}`);
      }
    }
  }

  async function resolveDefaultOwner(project: Project): Promise<string> {
    const report = await githubHandlers.authReport(project.workspaceId);
    const owner = report.activeAccount?.account;
    if (!owner) {
      throw new Error('No GitHub account is connected — sign in first.');
    }
    return owner;
  }

  return { diagnose, applyRemedy };
}

export type ProjectReadinessHandlers = ReturnType<typeof createProjectReadinessHandlers>;
