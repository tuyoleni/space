/**
 * GH-002: Credential setup for Git (spec 14.4). When HTTPS is selected,
 * Space may use `gh auth setup-git` to install `gh` as the Git credential
 * helper. The outcome must be verified with a non-destructive remote
 * authentication check (spec 14.4) — `git ls-remote` against the target
 * remote is that check: it requires a successful authenticated handshake
 * but reads only ref names, never mutating the remote or the local
 * working tree (spec 39: never hide partial side effects, never treat an
 * exit code alone as complete verification).
 */
import type { GitExecutor } from '@space/git-engine';
import { runGh } from './json';
import type { GhExecutor } from './executor';

export function setupGitArgs(hostname?: string): string[] {
  const args = ['auth', 'setup-git'];
  if (hostname) {
    args.push('--hostname', hostname);
  }
  return args;
}

export async function setupGitCredentialHelper(executor: GhExecutor, hostname?: string): Promise<void> {
  await runGh(executor, setupGitArgs(hostname));
}

export interface GitCredentialVerification {
  readonly verified: boolean;
  readonly detail: string;
}

/**
 * Runs `git ls-remote --exit-code <remoteUrl> HEAD` as the non-destructive
 * check (spec 14.4). A non-zero exit means either the remote is
 * unreachable or credentials were rejected — both are reported as
 * `verified: false` with the real stderr, never silently swallowed.
 */
export async function verifyGitCredentialHelper(remoteUrl: string, gitExecutor: GitExecutor): Promise<GitCredentialVerification> {
  if (remoteUrl.trim().length === 0 || remoteUrl.trim().startsWith('-')) {
    throw new Error(`Remote URL "${remoteUrl}" is not valid`);
  }
  const result = await gitExecutor(['ls-remote', '--exit-code', '--', remoteUrl, 'HEAD']);
  if (result.exitCode !== 0) {
    return { verified: false, detail: result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}` };
  }
  return { verified: true, detail: result.stdout.trim() };
}

/** Runs setup, then the non-destructive verification, in one step for the common case. */
export async function setupAndVerifyGitCredentialHelper(
  remoteUrl: string,
  ghExecutor: GhExecutor,
  gitExecutor: GitExecutor,
  hostname?: string,
): Promise<GitCredentialVerification> {
  await setupGitCredentialHelper(ghExecutor, hostname);
  return verifyGitCredentialHelper(remoteUrl, gitExecutor);
}
