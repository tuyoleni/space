/**
 * GH-001: Authentication (spec 14.3). Reports CLI-installed state,
 * authentication state by host, active workspace account, available
 * organisations where obtainable, git protocol, and token-source
 * strategy. Interactive login itself runs in a real PTY via
 * `@space/terminal`'s M4 PTY host (wired in `apps/desktop`); this module
 * only builds the argument array for that PTY command and parses the
 * read-only status commands.
 *
 * `gh auth status` has no `--json` form (verified against gh 2.95.0) — it
 * is the one command in this package that has to parse stable, versioned
 * text rather than structured JSON, which is a deliberate, documented
 * exception to the "prefer --json" rule (spec 14.5/39), not a silent
 * fallback. Every other command below uses `--json`.
 */
import { runGh, runGhJson, runGhJsonOptional } from './json';
import type { GhExecutor } from './executor';

export interface GhVersionInfo {
  readonly installed: boolean;
  readonly version: string | null;
  readonly raw: string;
}

const VERSION_LINE = /^gh version (\S+)/;

/** Parses `gh --version`'s first line, e.g. "gh version 2.95.0 (2025-06-10)". */
export function parseGhVersion(stdout: string): string | null {
  const firstLine = stdout.split('\n')[0] ?? '';
  const match = VERSION_LINE.exec(firstLine.trim());
  return match?.[1] ?? null;
}

/** CLI-installed state (spec 14.3). Never throws — a missing `gh` binary is a real, reportable state, not an error. */
export async function detectGhVersion(executor: GhExecutor): Promise<GhVersionInfo> {
  try {
    const result = await executor(['--version']);
    if (result.exitCode !== 0) {
      return { installed: false, version: null, raw: result.stderr || result.stdout };
    }
    return { installed: true, version: parseGhVersion(result.stdout), raw: result.stdout };
  } catch {
    return { installed: false, version: null, raw: '' };
  }
}

export interface GhAuthAccount {
  readonly host: string;
  readonly account: string;
  readonly active: boolean;
  /** e.g. "keyring", a hosts.yml path, or null when not reported. Never the token itself. */
  readonly tokenSource: string | null;
  readonly scopes: readonly string[];
}

export interface GhAuthStatusReport {
  readonly authenticated: boolean;
  readonly accounts: readonly GhAuthAccount[];
}

const ANSI_ESCAPE = /\x1B\[[0-9;]*[a-zA-Z]/g;
const HOST_LINE = /^(\S+\.\S+)$/;
const ACCOUNT_LINE = /Logged in to \S+ (?:account )?(\S+)(?:\s*\(([^)]+)\))?/;
const ACTIVE_LINE = /Active account:\s*(true|false)/i;
const SCOPES_LINE = /Token scopes:\s*(.+)/i;

/**
 * Parses `gh auth status`'s stable text layout: an unindented host line
 * followed by indented per-account detail lines, repeated per host. Both
 * stdout and stderr are accepted since different `gh` versions have
 * written this report to either stream.
 */
export function parseAuthStatus(rawOutput: string, exitCode: number | null): GhAuthStatusReport {
  const clean = rawOutput.replace(ANSI_ESCAPE, '');
  const lines = clean.split('\n');

  const accounts: GhAuthAccount[] = [];
  let currentHost: string | null = null;
  let pending: { host: string; account: string; tokenSource: string | null; scopes: string[]; active: boolean } | null = null;

  const flush = (): void => {
    if (pending) {
      accounts.push({ host: pending.host, account: pending.account, active: pending.active, tokenSource: pending.tokenSource, scopes: pending.scopes });
      pending = null;
    }
  };

  for (const rawLine of lines) {
    const isIndented = /^\s/.test(rawLine);
    const trimmed = rawLine.replace(/^[\s✓✗\-•]+/, '').trim();
    if (trimmed.length === 0) continue;

    const hostMatch = !isIndented ? HOST_LINE.exec(trimmed) : null;
    if (hostMatch?.[1]) {
      flush();
      currentHost = hostMatch[1];
      continue;
    }

    const accountMatch = ACCOUNT_LINE.exec(trimmed);
    if (accountMatch?.[1] && currentHost) {
      flush();
      pending = { host: currentHost, account: accountMatch[1], tokenSource: accountMatch[2] ?? null, scopes: [], active: false };
      continue;
    }

    const activeMatch = ACTIVE_LINE.exec(trimmed);
    if (activeMatch?.[1] && pending) {
      pending.active = activeMatch[1].toLowerCase() === 'true';
      continue;
    }

    const scopesMatch = SCOPES_LINE.exec(trimmed);
    if (scopesMatch?.[1] && pending) {
      pending.scopes = scopesMatch[1].split(',').map((scope) => scope.trim().replace(/^'|'$/g, '')).filter(Boolean);
    }
  }
  flush();

  return { authenticated: exitCode === 0 && accounts.length > 0, accounts };
}

/** Runs `gh auth status` for real and parses it (spec 14.3). Never throws on "not authenticated" — that is a real, reportable state. */
export async function loadAuthStatus(executor: GhExecutor): Promise<GhAuthStatusReport> {
  const result = await executor(['auth', 'status']);
  return parseAuthStatus(`${result.stdout}\n${result.stderr}`, result.exitCode);
}

/** The account report treats as "active" for whichever host is asked about, or the sole account if there is exactly one. */
export function activeAccountFor(report: GhAuthStatusReport, host?: string): GhAuthAccount | null {
  const scoped = host ? report.accounts.filter((account) => account.host === host) : report.accounts;
  return scoped.find((account) => account.active) ?? (scoped.length === 1 ? (scoped[0] ?? null) : null);
}

export interface GhOrg {
  readonly login: string;
  readonly id: number;
}

/** Available organisations "where obtainable" (spec 14.3) — resolves to null rather than throwing when the API call fails (e.g. unauthenticated). */
export async function listAvailableOrgs(executor: GhExecutor): Promise<readonly GhOrg[] | null> {
  return runGhJsonOptional<GhOrg[]>(executor, ['api', 'user/orgs', '--jq', '[.[] | {login: .login, id: .id}]']);
}

export interface GhUserIdentity {
  readonly name: string;
  readonly email: string;
}

interface GhApiUserResponse {
  readonly login: string;
  readonly name: string | null;
  readonly email: string | null;
}

/**
 * Derives a commit identity (name + email) from the authenticated GitHub
 * account via `gh api user`, for the one-time fallback git-handlers.ts
 * uses when the machine has no global `git config user.name`/`user.email`
 * (spec 11.6's "workspace identity" is otherwise unavailable). `email` is
 * frequently `null` from this endpoint (GitHub hides it by default), in
 * which case `login`'s noreply address — the same address GitHub's own
 * web-commit UI uses — stands in. Resolves to `null` rather than throwing
 * so an unauthenticated or offline caller gets a clean "no fallback"
 * signal instead of a crash.
 */
export async function resolveGithubIdentity(executor: GhExecutor): Promise<GhUserIdentity | null> {
  const user = await runGhJsonOptional<GhApiUserResponse>(executor, [
    'api',
    'user',
    '--jq',
    '{login: .login, name: .name, email: .email}',
  ]);
  if (!user?.login) {
    return null;
  }
  return {
    name: user.name ?? user.login,
    email: user.email ?? `${user.login}@users.noreply.github.com`,
  };
}

export type GhGitProtocol = 'https' | 'ssh';

/** `gh config get git_protocol` prints a single bare value, not JSON — there is no structured alternative for a single scalar config read. */
export async function getGitProtocol(executor: GhExecutor): Promise<GhGitProtocol | null> {
  try {
    const result = await runGh(executor, ['config', 'get', 'git_protocol']);
    const value = result.stdout.trim().toLowerCase();
    return value === 'https' || value === 'ssh' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Space's own credential-architecture concept (spec 5.6), not something
 * `gh` itself reports: whether the active token is one Space placed in
 * the OS credential store under its own service/account identifier, or
 * one `gh` manages itself (its default keyring/hosts.yml behaviour).
 */
export type TokenSourceStrategy = 'space-managed-os-keychain' | 'gh-default' | 'unknown';

export interface GithubAuthReport {
  readonly cliInstalled: boolean;
  readonly cliVersion: string | null;
  readonly authenticated: boolean;
  readonly accounts: readonly GhAuthAccount[];
  readonly activeAccount: GhAuthAccount | null;
  readonly availableOrgs: readonly GhOrg[] | null;
  readonly gitProtocol: GhGitProtocol | null;
  readonly tokenSourceStrategy: TokenSourceStrategy;
}

/** Assembles the full GH-001 report from the individual real reads above. */
export async function loadGithubAuthReport(
  executor: GhExecutor,
  options: { readonly tokenSourceStrategy: TokenSourceStrategy; readonly host?: string },
): Promise<GithubAuthReport> {
  const version = await detectGhVersion(executor);
  if (!version.installed) {
    return {
      cliInstalled: false,
      cliVersion: null,
      authenticated: false,
      accounts: [],
      activeAccount: null,
      availableOrgs: null,
      gitProtocol: null,
      tokenSourceStrategy: options.tokenSourceStrategy,
    };
  }

  const status = await loadAuthStatus(executor);
  const [orgs, gitProtocol] = await Promise.all([
    status.authenticated ? listAvailableOrgs(executor) : Promise.resolve(null),
    getGitProtocol(executor),
  ]);

  return {
    cliInstalled: true,
    cliVersion: version.version,
    authenticated: status.authenticated,
    accounts: status.accounts,
    activeAccount: activeAccountFor(status, options.host),
    availableOrgs: orgs,
    gitProtocol,
    tokenSourceStrategy: options.tokenSourceStrategy,
  };
}

export interface GhAuthLoginOptions {
  readonly hostname?: string;
  readonly gitProtocol?: GhGitProtocol;
  /** Browser-based device flow. When false, `gh` falls back to a pasted token prompt inside the PTY. */
  readonly web?: boolean;
  readonly scopes?: readonly string[];
}

/**
 * Builds the argument array for an interactive `gh auth login`, run in a
 * real PTY (spec 14.3: "normal gh auth login flows in an interactive
 * PTY"). This module never spawns that PTY itself — the caller (a
 * privileged main-process handler) passes this to `@space/terminal`'s
 * `PtyHost`, which shows the user the resulting hostname/account but
 * never the token.
 */
export function ghAuthLoginArgs(options: GhAuthLoginOptions = {}): string[] {
  const args = ['auth', 'login'];
  if (options.hostname) {
    args.push('--hostname', options.hostname);
  }
  if (options.gitProtocol) {
    args.push('--git-protocol', options.gitProtocol);
  }
  if (options.web) {
    args.push('--web');
  }
  if (options.scopes && options.scopes.length > 0) {
    args.push('--scopes', options.scopes.join(','));
  }
  return args;
}

/** `gh auth logout` — structured args, no confirmation gate required (logging out is locally reversible: the user can log back in). */
export function ghAuthLogoutArgs(hostname?: string): string[] {
  const args = ['auth', 'logout'];
  if (hostname) {
    args.push('--hostname', hostname);
  }
  return args;
}

export async function logout(executor: GhExecutor, hostname?: string): Promise<void> {
  await runGh(executor, ghAuthLogoutArgs(hostname));
}

/** `gh auth token [--hostname <host>]` prints the current, real token for that host and nothing else — the one command whose stdout is deliberately sensitive rather than something safe to log or return in an error message. */
export function ghAuthTokenArgs(hostname?: string): string[] {
  const args = ['auth', 'token'];
  if (hostname) {
    args.push('--hostname', hostname);
  }
  return args;
}

/**
 * Reads the real token `gh` just obtained after a successful interactive
 * login (spec 5.6, ADR-002: the caller stores this in Space's own OS
 * credential store under its own service/account identifier — this
 * function never persists anything itself). Resolves to `null` rather
 * than throwing when `gh` has no token for that host, since that is a
 * legitimate "login didn't actually succeed" state the caller must
 * handle, not a crash.
 */
export async function getAuthToken(executor: GhExecutor, hostname?: string): Promise<string | null> {
  const result = await executor(ghAuthTokenArgs(hostname));
  if (result.exitCode !== 0) {
    return null;
  }
  const token = result.stdout.trim();
  return token.length > 0 ? token : null;
}
