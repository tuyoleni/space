/**
 * GIT-007: fetch, pull, push (spec 11.10). Fetch is a normal action; pull
 * makes merge-vs-rebase explicit; push always shows identity/remote/branch/
 * force-state before running (`describePush`) and defaults force pushes to
 * `--force-with-lease`. Raw `--force` requires both the structural
 * confirmation gate *and* an explicit policy flag (spec 11.10, mirrored
 * from @space/domain's `assertDestructiveGitActionConfirmed`).
 */
import { assertDestructiveGitActionConfirmed } from '@space/domain';
import { fetchArgs, pullArgs, pushArgs, remoteAddArgs, remoteGetUrlArgs, remoteVerboseArgs, type PullMode } from './commands';
import type { GitIdentity } from './identity';
import type { GitExecutor } from './clone';

export interface RemoteCommandOutcome {
  readonly stdout: string;
  readonly stderr: string;
}

/** One configured remote with its fetch/push URLs; `pushUrl` equals `fetchUrl` unless a distinct push URL is configured. */
export interface RemoteEntry {
  readonly name: string;
  readonly fetchUrl: string;
  readonly pushUrl: string;
}

async function run(executor: GitExecutor, args: string[], cwd: string): Promise<RemoteCommandOutcome> {
  const result = await executor(args, { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function fetchRemote(cwd: string, remoteName: string, executor: GitExecutor): Promise<RemoteCommandOutcome> {
  return run(executor, fetchArgs(remoteName), cwd);
}

/** Adds a remote (spec 14.5 GH-003's "connect" resolution) — never overwrites an existing remote of the same name; `git remote add` itself already fails loudly if one exists. */
export async function addRemote(cwd: string, remoteName: string, url: string, executor: GitExecutor): Promise<RemoteCommandOutcome> {
  return run(executor, remoteAddArgs(remoteName, url), cwd);
}

/** Returns the current URL for `remoteName`, or `null` if it does not exist — used to detect a name collision before `addRemote`. */
export async function getRemoteUrl(cwd: string, remoteName: string, executor: GitExecutor): Promise<string | null> {
  const result = await executor(remoteGetUrlArgs(remoteName), { cwd });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

/**
 * Parses `git remote -v` output — two lines per remote, one tagged
 * `(fetch)` and one `(push)` — into one entry per remote, preserving the
 * order remotes first appear. Returns `[]` for a repository with no
 * remotes.
 */
export function parseRemoteVerbose(stdout: string): RemoteEntry[] {
  const fetchByName = new Map<string, string>();
  const pushByName = new Map<string, string>();
  const order: string[] = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.trimEnd();
    if (line.length === 0) {
      continue;
    }
    // "<name>\t<url> (fetch)" | "<name>\t<url> (push)"
    const tab = line.indexOf('\t');
    if (tab === -1) {
      continue;
    }
    const name = line.slice(0, tab);
    const match = /^(.*)\s+\((fetch|push)\)$/.exec(line.slice(tab + 1));
    if (!match) {
      continue;
    }
    const url = (match[1] ?? '').trim();
    if (!order.includes(name)) {
      order.push(name);
    }
    (match[2] === 'push' ? pushByName : fetchByName).set(name, url);
  }
  return order.map((name) => {
    const fetchUrl = fetchByName.get(name) ?? pushByName.get(name) ?? '';
    return { name, fetchUrl, pushUrl: pushByName.get(name) ?? fetchUrl };
  });
}

/** Lists the repository's configured remotes and their URLs (`git remote -v`). */
export async function listRemotes(cwd: string, executor: GitExecutor): Promise<RemoteEntry[]> {
  const result = await executor(remoteVerboseArgs(), { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git remote failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`);
  }
  return parseRemoteVerbose(result.stdout);
}

export async function pullRemote(
  cwd: string,
  mode: PullMode,
  remoteName: string,
  branch: string | undefined,
  executor: GitExecutor,
): Promise<RemoteCommandOutcome> {
  return run(executor, pullArgs(mode, remoteName, branch), cwd);
}

export type ForceMode = 'none' | 'with-lease' | 'raw';

export interface PushOptions {
  readonly branch: string;
  readonly remoteName?: string;
  readonly setUpstream?: boolean;
  readonly force?: ForceMode;
  /** Required whenever `force` is not 'none' (structural gate). */
  readonly confirmed?: boolean;
  /** Additional policy gate required for raw --force (spec 11.10). */
  readonly policyAllowsRawForce?: boolean;
}

export interface PushSummary {
  readonly identity: string;
  readonly remote: string;
  readonly branch: string;
  readonly forceState: ForceMode;
}

/** Pure summary the UI must show before a push runs (spec 11.10: "show workspace identity, remote, branch, and whether it is a force operation"). */
export function describePush(options: Pick<PushOptions, 'remoteName' | 'branch' | 'force'>, identity: GitIdentity): PushSummary {
  return {
    identity: `${identity.name} <${identity.email}>`,
    remote: options.remoteName ?? 'origin',
    branch: options.branch,
    forceState: options.force ?? 'none',
  };
}

export async function pushToRemote(cwd: string, options: PushOptions, executor: GitExecutor): Promise<RemoteCommandOutcome> {
  if (options.force && options.force !== 'none') {
    assertDestructiveGitActionConfirmed(
      { action: options.force === 'raw' ? 'force-push-raw' : 'force-push-with-lease', confirmed: options.confirmed ?? false },
      options.policyAllowsRawForce ?? false,
    );
  }
  return run(
    executor,
    pushArgs({
      branch: options.branch,
      ...(options.remoteName !== undefined ? { remoteName: options.remoteName } : {}),
      ...(options.setUpstream !== undefined ? { setUpstream: options.setUpstream } : {}),
      ...(options.force !== undefined ? { force: options.force } : {}),
    }),
    cwd,
  );
}
