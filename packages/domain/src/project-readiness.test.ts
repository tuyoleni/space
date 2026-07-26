import { describe, expect, it } from 'vitest';
import {
  blockingIssueFor,
  diagnoseProjectReadiness,
  recommendedRemedy,
  type ProjectReadinessSnapshot,
} from './project-readiness';

/** A project that is entirely fine — each test breaks exactly one thing. */
function healthy(overrides: Partial<ProjectReadinessSnapshot> = {}): ProjectReadinessSnapshot {
  return {
    projectName: 'space-landing',
    hasRepository: true,
    hasCommits: true,
    remoteNames: ['origin'],
    currentBranch: 'main',
    upstream: 'origin/main',
    githubCliInstalled: true,
    githubAuthenticated: true,
    githubAccount: 'tuyoleni',
    ...overrides,
  };
}

describe('diagnoseProjectReadiness', () => {
  it('reports nothing for a fully set-up project', () => {
    expect(diagnoseProjectReadiness(healthy())).toEqual([]);
  });

  it('reports only the root cause when the folder is not a repository', () => {
    // A folder with no repository also has no commits and no remote, but
    // saying so three times describes one problem as three.
    const issues = diagnoseProjectReadiness(
      healthy({ hasRepository: false, hasCommits: false, remoteNames: [], upstream: null }),
    );
    expect(issues.map((issue) => issue.id)).toEqual(['not-a-repository']);
    expect(recommendedRemedy(issues[0]!)?.id).toBe('initialize-repository');
  });

  it('offers to create the repository on GitHub when an account is connected', () => {
    const issues = diagnoseProjectReadiness(healthy({ remoteNames: [], upstream: null }));
    const noRemote = issues.find((issue) => issue.id === 'no-remote');
    expect(noRemote?.severity).toBe('blocking');
    expect(recommendedRemedy(noRemote!)?.id).toBe('publish-to-github');
    // The account is named, so the user knows where it will land.
    expect(recommendedRemedy(noRemote!)?.description).toContain('tuyoleni');
    // Linking an existing repo stays available as a secondary path.
    expect(noRemote?.remedies.map((r) => r.id)).toContain('add-existing-remote');
  });

  it('asks for sign-in rather than offering a creation it cannot perform', () => {
    const issues = diagnoseProjectReadiness(
      healthy({ remoteNames: [], upstream: null, githubAuthenticated: false, githubAccount: null }),
    );
    const noRemote = issues.find((issue) => issue.id === 'no-remote');
    expect(recommendedRemedy(noRemote!)?.id).toBe('sign-in-to-github');
    expect(noRemote?.remedies.map((r) => r.id)).not.toContain('publish-to-github');
  });

  it('offers to install the GitHub CLI before asking anyone to sign in to it', () => {
    const issues = diagnoseProjectReadiness(
      healthy({ remoteNames: [], upstream: null, githubCliInstalled: false, githubAuthenticated: false }),
    );
    const noRemote = issues.find((issue) => issue.id === 'no-remote');
    expect(recommendedRemedy(noRemote!)?.id).toBe('install-github-cli');
  });

  it('treats a never-published branch as advisory, not blocking', () => {
    const issues = diagnoseProjectReadiness(healthy({ upstream: null, currentBranch: 'feature/new-nav' }));
    const noUpstream = issues.find((issue) => issue.id === 'no-upstream');
    expect(noUpstream?.severity).toBe('advisory');
    expect(noUpstream?.title).toContain('feature/new-nav');
  });

  it('does not report a missing upstream when there is no remote at all', () => {
    // The remote is the real problem; an upstream cannot exist without one.
    const issues = diagnoseProjectReadiness(healthy({ remoteNames: [], upstream: null }));
    expect(issues.map((issue) => issue.id)).not.toContain('no-upstream');
  });

  it('flags a repository that has never been committed to', () => {
    const issues = diagnoseProjectReadiness(healthy({ hasCommits: false }));
    expect(issues.map((issue) => issue.id)).toContain('no-commits');
  });

  it('never speaks Git jargon in a title', () => {
    // The whole point is that these read as problems, not as CLI output.
    const snapshots = [
      healthy({ hasRepository: false }),
      healthy({ hasCommits: false }),
      healthy({ remoteNames: [], upstream: null }),
    ];
    const jargon = ['origin', 'fatal:', 'HEAD', 'refspec', 'upstream branch'];
    for (const snapshot of snapshots) {
      for (const issue of diagnoseProjectReadiness(snapshot)) {
        for (const term of jargon) {
          expect(issue.title.toLowerCase()).not.toContain(term.toLowerCase());
        }
      }
    }
  });

  it('gives every issue at least one remedy', () => {
    const snapshots = [
      healthy({ hasRepository: false }),
      healthy({ hasCommits: false }),
      healthy({ remoteNames: [], upstream: null }),
      healthy({ remoteNames: [], upstream: null, githubAuthenticated: false }),
      healthy({ upstream: null }),
    ];
    for (const snapshot of snapshots) {
      for (const issue of diagnoseProjectReadiness(snapshot)) {
        expect(issue.remedies.length).toBeGreaterThan(0);
      }
    }
  });

  it('marks at most one remedy per issue as recommended', () => {
    const issues = diagnoseProjectReadiness(healthy({ remoteNames: [], upstream: null }));
    for (const issue of issues) {
      expect(issue.remedies.filter((remedy) => remedy.recommended)).toHaveLength(1);
    }
  });
});

describe('blockingIssueFor', () => {
  it('catches the missing remote before a push is attempted', () => {
    // This is the exact case that produced
    // "fatal: 'origin' does not appear to be a git repository".
    const issues = diagnoseProjectReadiness(healthy({ remoteNames: [], upstream: null }));
    expect(blockingIssueFor('push', issues)?.id).toBe('no-remote');
  });

  it('lets a push through when nothing is wrong', () => {
    expect(blockingIssueFor('push', diagnoseProjectReadiness(healthy()))).toBeNull();
  });

  it('does not block a push on the advisory missing-upstream issue', () => {
    // Pushing is how an upstream gets set; blocking on it would be circular.
    const issues = diagnoseProjectReadiness(healthy({ upstream: null }));
    expect(blockingIssueFor('push', issues)).toBeNull();
  });

  it('does not block a commit on a missing remote', () => {
    // Committing is local; needing somewhere to publish to is a later concern.
    const issues = diagnoseProjectReadiness(healthy({ remoteNames: [], upstream: null }));
    expect(blockingIssueFor('commit', issues)).toBeNull();
  });

  it('reports the most fundamental blocker first', () => {
    const issues = diagnoseProjectReadiness(
      healthy({ hasRepository: false, hasCommits: false, remoteNames: [], upstream: null }),
    );
    expect(blockingIssueFor('push', issues)?.id).toBe('not-a-repository');
  });
});
