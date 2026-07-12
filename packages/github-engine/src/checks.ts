/**
 * GH-005: Checks (spec 14.7). PR detail must display each check's name,
 * state, workflow/job association, start/finish time, details URL, and
 * required-check status, all read via `gh pr checks --json` (spec 14.5:
 * "should use structured JSON output"). Watching status may poll, but
 * must back off and stop either when the caller says the view closed or
 * once every check has reached a terminal state (spec 14.7) — polling
 * never runs unbounded.
 */
import { runGhJson, runGhJsonOptional } from './json';
import type { GhExecutor } from './executor';

export type CheckBucket = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';

export interface CheckRun {
  readonly name: string;
  readonly state: string;
  readonly workflow: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly link: string;
  readonly bucket: CheckBucket;
}

const CHECKS_JSON_FIELDS = 'name,state,startedAt,completedAt,link,bucket,workflow';

export function prChecksArgs(number: number): string[] {
  return ['pr', 'checks', String(number), '--json', CHECKS_JSON_FIELDS];
}

/** `gh pr checks` exits non-zero when any check is failing, even though the JSON body is still valid — so this reads the raw command rather than `runGhJson`'s throw-on-failure wrapper. */
export async function loadChecks(executor: GhExecutor, number: number): Promise<CheckRun[]> {
  const result = await executor(prChecksArgs(number));
  if (result.stdout.trim().length === 0) {
    if (result.exitCode !== 0) {
      throw new Error(`gh pr checks ${number} failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`);
    }
    return [];
  }
  return JSON.parse(result.stdout) as CheckRun[];
}

const TERMINAL_BUCKETS: ReadonlySet<CheckBucket> = new Set(['pass', 'fail', 'skipping', 'cancel']);

export function isTerminalCheckBucket(bucket: CheckBucket): boolean {
  return TERMINAL_BUCKETS.has(bucket);
}

export function allChecksComplete(checks: readonly CheckRun[]): boolean {
  return checks.length > 0 && checks.every((check) => isTerminalCheckBucket(check.bucket));
}

export function anyCheckFailing(checks: readonly CheckRun[]): boolean {
  return checks.some((check) => check.bucket === 'fail');
}

/**
 * Required-check names come from branch protection, a separate,
 * "where obtainable" read (spec 14.3's pattern applied to 14.7): a
 * non-admin token or an unprotected branch legitimately 404s, so this
 * resolves to `null` rather than throwing.
 */
export async function loadRequiredCheckNames(
  executor: GhExecutor,
  nameWithOwner: string,
  branch: string,
): Promise<readonly string[] | null> {
  return runGhJsonOptional<string[]>(executor, [
    'api',
    `repos/${nameWithOwner}/branches/${branch}/protection`,
    '--jq',
    '.required_status_checks.contexts // []',
  ]);
}

export interface RequiredCheckStatus {
  readonly requiredNames: readonly string[];
  readonly missing: readonly string[];
  readonly allRequiredPassing: boolean;
}

export function deriveRequiredCheckStatus(checks: readonly CheckRun[], requiredNames: readonly string[] | null): RequiredCheckStatus {
  const names = requiredNames ?? [];
  const passingNames = new Set(checks.filter((check) => check.bucket === 'pass').map((check) => check.name));
  const missing = names.filter((name) => !passingNames.has(name));
  return { requiredNames: names, missing, allRequiredPassing: missing.length === 0 };
}

export interface PollChecksOptions {
  /** Backoff schedule in ms, applied in order and held at the last value once exhausted. Defaults to a gentle ramp capped at 30s. */
  readonly backoffMs?: readonly number[];
  /** Polling stops immediately once this returns true (spec 14.7: "stop when the view is closed"). */
  readonly isCancelled: () => boolean;
  /** Injected so tests never really sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxAttempts?: number;
}

const DEFAULT_BACKOFF_MS = [2_000, 4_000, 8_000, 15_000, 30_000];

export type PollChecksStopReason = 'complete' | 'cancelled' | 'max-attempts';

export interface PollChecksResult {
  readonly checks: readonly CheckRun[];
  readonly stoppedReason: PollChecksStopReason;
  readonly attempts: number;
}

/**
 * Polls `gh pr checks` with backoff until every check reaches a terminal
 * state, the caller's `isCancelled` reports the view closed, or
 * `maxAttempts` is hit (a hard ceiling so a stuck check can never poll
 * forever). Never throws on a failing check — a failure is a terminal,
 * reportable state, not an error.
 */
export async function pollChecksUntilComplete(executor: GhExecutor, number: number, options: PollChecksOptions): Promise<PollChecksResult> {
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = options.maxAttempts ?? 60;

  let attempts = 0;
  let checks: CheckRun[] = [];

  while (attempts < maxAttempts) {
    if (options.isCancelled()) {
      return { checks, stoppedReason: 'cancelled', attempts };
    }
    checks = await loadChecks(executor, number);
    attempts += 1;
    if (allChecksComplete(checks)) {
      return { checks, stoppedReason: 'complete', attempts };
    }
    if (options.isCancelled()) {
      return { checks, stoppedReason: 'cancelled', attempts };
    }
    const delay = backoff[Math.min(attempts - 1, backoff.length - 1)] ?? 30_000;
    await sleep(delay);
  }
  return { checks, stoppedReason: 'max-attempts', attempts };
}
