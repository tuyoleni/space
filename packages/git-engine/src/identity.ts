/**
 * GIT-003: identity resolution (spec 11.6). Before the first commit in a
 * workspace, or after an identity mismatch, Space resolves author name,
 * author email, signing policy, and signing key availability. A
 * repository-local identity may only override the workspace identity
 * after an explicit user action (`overrideAcknowledged`) — Space never
 * silently defers to whatever happens to already be in `.git/config`.
 *
 * The resolved identity is always injected as `-c user.name=... -c
 * user.email=...` on the actual git invocation (never written to any
 * config file), which is how a single git command-line invocation always
 * wins over on-disk config regardless of source — see `identityConfigArgs`.
 */
import { configGetArgs } from './commands';
import type { GitExecutor } from './clone';

export type SigningPolicy = 'none' | 'gpg' | 'ssh';

export interface GitIdentity {
  readonly name: string;
  readonly email: string;
  readonly signingPolicy: SigningPolicy;
  readonly signingKeyId: string | null;
}

export interface RepoLocalIdentity {
  readonly name: string | null;
  readonly email: string | null;
}

export interface IdentityResolution {
  readonly identity: GitIdentity;
  readonly source: 'workspace' | 'repo-local';
  /** True when the repo has a local identity that differs and has not been acknowledged. */
  readonly mismatch: boolean;
}

export function resolveCommitIdentity(input: {
  readonly workspaceIdentity: GitIdentity;
  readonly repoLocal: RepoLocalIdentity;
  readonly overrideAcknowledged: boolean;
}): IdentityResolution {
  const hasRepoLocal = input.repoLocal.name !== null && input.repoLocal.email !== null;
  const differs =
    hasRepoLocal &&
    (input.repoLocal.name !== input.workspaceIdentity.name ||
      input.repoLocal.email !== input.workspaceIdentity.email);

  if (hasRepoLocal && input.overrideAcknowledged) {
    return {
      identity: {
        ...input.workspaceIdentity,
        name: input.repoLocal.name as string,
        email: input.repoLocal.email as string,
      },
      source: 'repo-local',
      mismatch: false,
    };
  }

  return { identity: input.workspaceIdentity, source: 'workspace', mismatch: differs };
}

/** `-c` overrides that make the resolved identity authoritative for one invocation, never a config file write. */
export function identityConfigArgs(identity: GitIdentity): string[] {
  const args = ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`];
  if (identity.signingPolicy === 'none') {
    args.push('-c', 'commit.gpgsign=false');
    return args;
  }
  args.push('-c', 'commit.gpgsign=true', '-c', `gpg.format=${identity.signingPolicy === 'ssh' ? 'ssh' : 'openpgp'}`);
  if (identity.signingKeyId) {
    args.push('-c', `user.signingkey=${identity.signingKeyId}`);
  }
  return args;
}

export async function readRepoLocalIdentity(cwd: string, executor: GitExecutor): Promise<RepoLocalIdentity> {
  const [name, email] = await Promise.all([
    executor(configGetArgs('user.name', 'local'), { cwd }),
    executor(configGetArgs('user.email', 'local'), { cwd }),
  ]);
  return {
    name: name.exitCode === 0 && name.stdout.trim().length > 0 ? name.stdout.trim() : null,
    email: email.exitCode === 0 && email.stdout.trim().length > 0 ? email.stdout.trim() : null,
  };
}

/** Injected so a real implementation can shell out to gpg/ssh-keygen without this module ever doing so itself. */
export type SigningKeyChecker = (policy: Exclude<SigningPolicy, 'none'>, keyId: string) => Promise<boolean>;

/** Returns null when signing is not configured (not applicable), else whether the configured key is usable. */
export async function checkSigningKeyAvailability(
  identity: GitIdentity,
  checker: SigningKeyChecker,
): Promise<boolean | null> {
  if (identity.signingPolicy === 'none') {
    return null;
  }
  if (!identity.signingKeyId) {
    return false;
  }
  return checker(identity.signingPolicy, identity.signingKeyId);
}
