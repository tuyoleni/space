/**
 * Project readiness: what is actually wrong with a project, said in
 * language a person can act on, together with the fixes Space can perform.
 *
 * This exists because the failure mode Space is meant to remove is exactly
 * the one it was producing: a user clicks Push, the real `git` CLI answers
 * `fatal: 'origin' does not appear to be a git repository`, and that string
 * is shown verbatim. The message is accurate and useless — it names a
 * condition, not a next step, and it assumes the reader knows what a remote
 * is.
 *
 * The important design choice here is that these are *preconditions*, not
 * error translations. "No remote is configured" is knowable before `git
 * push` runs, from state Space already has. Checking first and offering the
 * fix is deterministic, instant, works offline, needs no API key, and
 * cannot be wrong the way interpreting an error string can. A model is the
 * right tool for a genuinely unrecognised failure; it is the wrong tool for
 * a condition with one known cause and one known remedy.
 *
 * Everything here is pure: callers gather a `ProjectReadinessSnapshot` from
 * the real Git/GitHub state and act on the returned remedies themselves.
 */

export interface ProjectReadinessSnapshot {
  readonly projectName: string;
  /** A real `.git` exists and Space has recorded its root. */
  readonly hasRepository: boolean;
  /** At least one commit exists — a repository with none cannot be pushed. */
  readonly hasCommits: boolean;
  /** Configured remote names (`origin`, …). Empty means nothing to push to. */
  readonly remoteNames: readonly string[];
  readonly currentBranch: string | null;
  /** The tracking branch, when the current branch has one. */
  readonly upstream: string | null;
  readonly githubCliInstalled: boolean;
  readonly githubAuthenticated: boolean;
  /** The signed-in account, used to name the owner a repository would be created under. */
  readonly githubAccount: string | null;
}

export type ProjectIssueId =
  | 'not-a-repository'
  | 'no-commits'
  | 'no-remote'
  | 'no-upstream'
  | 'github-cli-missing'
  | 'github-signed-out';

/** What Space would do about an issue. */
export type ProjectRemedyId =
  | 'initialize-repository'
  | 'create-initial-commit'
  | 'publish-to-github'
  | 'add-existing-remote'
  | 'push-and-set-upstream'
  | 'install-github-cli'
  | 'sign-in-to-github';

export interface ProjectRemedy {
  readonly id: ProjectRemedyId;
  /** Button text. An action, not a noun. */
  readonly label: string;
  /** Exactly what will happen if chosen, including anything irreversible. */
  readonly description: string;
  /**
   * True when Space can carry this out with nothing further from the user.
   * False means the remedy opens a form or hands off (e.g. typing a remote
   * URL, completing a browser sign-in).
   */
  readonly automatic: boolean;
  /**
   * True when this is the remedy to lead with. At most one per issue; the
   * rest stay available but secondary, so a default never quietly becomes
   * the only visible option.
   */
  readonly recommended: boolean;
}

export interface ProjectIssue {
  readonly id: ProjectIssueId;
  /** `blocking` stops the attempted action; `advisory` is worth surfacing but not fatal. */
  readonly severity: 'blocking' | 'advisory';
  /** One line, plain language, no Git vocabulary the user hasn't already met. */
  readonly title: string;
  /** What it means and why it matters — still no jargon. */
  readonly detail: string;
  readonly remedies: readonly ProjectRemedy[];
}

/** The user-facing actions whose preconditions this module knows how to check. */
export type ProjectAction = 'commit' | 'push' | 'publish';

/**
 * Every problem worth telling the user about, most fundamental first, so a
 * caller that only shows one shows the one that has to be solved before the
 * others even make sense (there is no point offering "create a repository
 * on GitHub" to a folder that is not yet a repository at all).
 */
export function diagnoseProjectReadiness(snapshot: ProjectReadinessSnapshot): readonly ProjectIssue[] {
  const issues: ProjectIssue[] = [];

  if (!snapshot.hasRepository) {
    issues.push({
      id: 'not-a-repository',
      severity: 'blocking',
      title: `"${snapshot.projectName}" isn't tracked by Git yet`,
      detail:
        'Git records the history of your changes. This folder has no history yet, so there is nothing to save, compare, or publish. Setting it up keeps every file exactly where it is.',
      remedies: [
        {
          id: 'initialize-repository',
          label: 'Set up version history',
          description: 'Creates the repository inside this folder and saves everything currently in it as a first snapshot. No files are moved, renamed, or deleted.',
          automatic: true,
          recommended: true,
        },
      ],
    });
    // Everything below assumes a repository exists; reporting it too would
    // just be noise restating the same root cause.
    return issues;
  }

  if (!snapshot.hasCommits) {
    issues.push({
      id: 'no-commits',
      severity: 'blocking',
      title: 'Nothing has been saved yet',
      detail:
        'This project has version history set up, but no snapshot has been saved into it. There is nothing to publish until at least one exists.',
      remedies: [
        {
          id: 'create-initial-commit',
          label: 'Save a first snapshot',
          description: 'Saves everything currently in the folder as the first entry in the history.',
          automatic: true,
          recommended: true,
        },
      ],
    });
  }

  if (snapshot.remoteNames.length === 0) {
    issues.push({
      id: 'no-remote',
      severity: 'blocking',
      title: 'This project has no home online',
      detail:
        "Publishing sends your work to a copy hosted somewhere else — normally GitHub. This project isn't linked to one yet, which is why publishing fails.",
      remedies: buildNoRemoteRemedies(snapshot),
    });
  } else if (snapshot.upstream === null && snapshot.currentBranch !== null) {
    issues.push({
      id: 'no-upstream',
      severity: 'advisory',
      title: `"${snapshot.currentBranch}" hasn't been published before`,
      detail:
        'This line of work only exists on your machine so far. Publishing it the first time also tells Git where it belongs, so future publishes need no extra steps.',
      remedies: [
        {
          id: 'push-and-set-upstream',
          label: 'Publish this branch',
          description: `Sends "${snapshot.currentBranch}" to ${snapshot.remoteNames[0] ?? 'the remote'} and links the two so later publishes are one click.`,
          automatic: true,
          recommended: true,
        },
      ],
    });
  }

  return issues;
}

/**
 * The remedies for a missing remote depend on how far the user's GitHub
 * setup already is. Space never offers "create it on GitHub" when it has no
 * account to create it under — that would only trade one cryptic failure
 * for another a moment later.
 */
function buildNoRemoteRemedies(snapshot: ProjectReadinessSnapshot): readonly ProjectRemedy[] {
  const manualRemedy: ProjectRemedy = {
    id: 'add-existing-remote',
    label: 'Link an existing repository',
    description: 'Use this if the project already exists online somewhere. You will be asked for its address.',
    automatic: false,
    recommended: false,
  };

  if (!snapshot.githubCliInstalled) {
    return [
      {
        id: 'install-github-cli',
        label: 'Install GitHub support',
        description: "Installs GitHub's command-line tool, which Space uses to create and publish repositories on your behalf.",
        automatic: true,
        recommended: true,
      },
      manualRemedy,
    ];
  }

  if (!snapshot.githubAuthenticated) {
    return [
      {
        id: 'sign-in-to-github',
        label: 'Sign in to GitHub',
        description: 'Opens GitHub in your browser to connect your account. Space never sees or stores your password.',
        automatic: false,
        recommended: true,
      },
      manualRemedy,
    ];
  }

  return [
    {
      id: 'publish-to-github',
      label: 'Create it on GitHub',
      description: snapshot.githubAccount
        ? `Creates a private repository under ${snapshot.githubAccount}, links this project to it, and uploads your work.`
        : 'Creates a private repository on your connected account, links this project to it, and uploads your work.',
      automatic: true,
      recommended: true,
    },
    manualRemedy,
  ];
}

/** Which issues actually stand between the user and one specific action. */
const BLOCKERS_BY_ACTION: Readonly<Record<ProjectAction, readonly ProjectIssueId[]>> = {
  commit: ['not-a-repository'],
  push: ['not-a-repository', 'no-commits', 'no-remote'],
  publish: ['not-a-repository', 'no-commits', 'no-remote'],
};

/**
 * The one issue to raise before attempting `action`, or null when nothing
 * stands in the way. Callers use this as a pre-flight check so the user
 * meets a resolvable question instead of a failed command's stderr.
 */
export function blockingIssueFor(
  action: ProjectAction,
  issues: readonly ProjectIssue[],
): ProjectIssue | null {
  const relevant = BLOCKERS_BY_ACTION[action];
  return issues.find((issue) => relevant.includes(issue.id)) ?? null;
}

/** The remedy a "just fix it" affordance should run, when exactly one is obvious. */
export function recommendedRemedy(issue: ProjectIssue): ProjectRemedy | null {
  return issue.remedies.find((remedy) => remedy.recommended) ?? null;
}
