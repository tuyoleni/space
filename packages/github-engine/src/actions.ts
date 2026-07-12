/**
 * GH-006: Actions (spec 14.8). List workflows, view recent runs, trigger
 * `workflow_dispatch` with real branch/tag and input values, watch a run,
 * view jobs/logs, download artifacts, cancel, and rerun. Every read uses
 * `gh`'s structured `--json` output.
 *
 * "Space must not invent inputs; it should read workflow metadata or ask
 * for explicit values" (spec 14.8) — `loadWorkflowDispatchInputs` fetches
 * the workflow file's real content via `gh api .../contents/...` and
 * parses its `workflow_dispatch.inputs` block (`workflow-metadata.ts`)
 * rather than guessing a shape.
 *
 * Triggering a workflow is treated as a high-impact remote action (spec
 * 39's general caution against unreviewed remote mutation, extended here
 * beyond the two cases the spec names explicitly — merge and release
 * publish — because a workflow run is real CI automation against a real
 * ref): `triggerWorkflowDispatch` is gated the same way `mergePullRequest`
 * and `publishRelease` are.
 */
import { assertHighImpactGithubActionConfirmed } from '@space/domain';
import { runGh, runGhJson, runGhJsonOptional } from './json';
import { parseWorkflowDispatchInputs, type WorkflowDispatchInputDefinition } from './workflow-metadata';
import type { GhExecutor } from './executor';

export interface WorkflowSummary {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  readonly state: string;
}

const WORKFLOW_LIST_JSON_FIELDS = 'id,name,path,state';

export function workflowListArgs(): string[] {
  return ['workflow', 'list', '--json', WORKFLOW_LIST_JSON_FIELDS];
}

export async function listWorkflows(executor: GhExecutor): Promise<WorkflowSummary[]> {
  return runGhJson<WorkflowSummary[]>(executor, workflowListArgs());
}

/** Fetches a workflow file's real content and parses its `workflow_dispatch.inputs` (spec 14.8: never invent inputs). Resolves to `[]` when the file can't be read rather than throwing, so the caller can still fall back to "ask for explicit values" with no assumed shape. */
export async function loadWorkflowDispatchInputs(
  executor: GhExecutor,
  nameWithOwner: string,
  workflowPath: string,
  ref?: string,
): Promise<readonly WorkflowDispatchInputDefinition[]> {
  const args = ['api', `repos/${nameWithOwner}/contents/${workflowPath}`, '--jq', '.content'];
  if (ref) {
    args.splice(2, 0, '-f', `ref=${ref}`);
  }
  const result = await executor(args);
  if (result.exitCode !== 0) {
    return [];
  }
  const base64 = result.stdout.trim().replace(/\n/g, '');
  if (base64.length === 0) {
    return [];
  }
  const yamlText = Buffer.from(base64, 'base64').toString('utf-8');
  return parseWorkflowDispatchInputs(yamlText);
}

export interface WorkflowRunSummary {
  readonly databaseId: number;
  readonly name: string;
  readonly displayTitle: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly workflowName: string;
  readonly headBranch: string;
  readonly event: string;
  readonly createdAt: string;
  readonly url: string;
}

const RUN_LIST_JSON_FIELDS = 'databaseId,name,displayTitle,status,conclusion,workflowName,headBranch,event,createdAt,url';

export interface RunListFilter {
  readonly workflow?: string;
  readonly branch?: string;
  readonly limit?: number;
}

export function runListArgs(filter: RunListFilter = {}): string[] {
  const args = ['run', 'list', '--json', RUN_LIST_JSON_FIELDS];
  if (filter.workflow) args.push('--workflow', filter.workflow);
  if (filter.branch) args.push('--branch', filter.branch);
  args.push('--limit', String(filter.limit ?? 20));
  return args;
}

export async function listRuns(executor: GhExecutor, filter: RunListFilter = {}): Promise<WorkflowRunSummary[]> {
  return runGhJson<WorkflowRunSummary[]>(executor, runListArgs(filter));
}

export interface WorkflowDispatchTriggerInput {
  readonly workflow: string;
  readonly ref: string;
  readonly inputs?: Readonly<Record<string, string>>;
  readonly confirmed: boolean;
}

export function workflowRunArgs(input: Pick<WorkflowDispatchTriggerInput, 'workflow' | 'ref' | 'inputs'>): string[] {
  const args = ['workflow', 'run', input.workflow, '--ref', input.ref];
  for (const [key, value] of Object.entries(input.inputs ?? {})) {
    args.push('-f', `${key}=${value}`);
  }
  return args;
}

export async function triggerWorkflowDispatch(executor: GhExecutor, input: WorkflowDispatchTriggerInput): Promise<void> {
  assertHighImpactGithubActionConfirmed({ action: 'trigger-workflow-dispatch', confirmed: input.confirmed });
  await runGh(executor, workflowRunArgs(input));
}

export interface RunJob {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
}

export interface RunDetail extends WorkflowRunSummary {
  readonly jobs: readonly RunJob[];
}

const RUN_VIEW_JSON_FIELDS = `${RUN_LIST_JSON_FIELDS},jobs`;

export function runViewArgs(id: number): string[] {
  return ['run', 'view', String(id), '--json', RUN_VIEW_JSON_FIELDS];
}

export async function viewRun(executor: GhExecutor, id: number): Promise<RunDetail> {
  return runGhJson<RunDetail>(executor, runViewArgs(id));
}

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(['completed', 'cancelled', 'failure']);

export function isRunComplete(run: Pick<RunDetail, 'status'>): boolean {
  return TERMINAL_RUN_STATUSES.has(run.status);
}

export interface PollRunOptions {
  readonly backoffMs?: readonly number[];
  readonly isCancelled: () => boolean;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxAttempts?: number;
}

const DEFAULT_RUN_BACKOFF_MS = [3_000, 5_000, 10_000, 20_000, 30_000];

export interface PollRunResult {
  readonly run: RunDetail | null;
  readonly stoppedReason: 'complete' | 'cancelled' | 'max-attempts';
  readonly attempts: number;
}

/** `gh run watch` prints colored, non-JSON progress; Space instead polls `gh run view --json` itself (spec 14.5/39), backing off and stopping when the view closes or the run is complete (spec 14.7's polling rule, reused here for runs). */
export async function pollRunUntilComplete(executor: GhExecutor, id: number, options: PollRunOptions): Promise<PollRunResult> {
  const backoff = options.backoffMs ?? DEFAULT_RUN_BACKOFF_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = options.maxAttempts ?? 120;

  let attempts = 0;
  let run: RunDetail | null = null;

  while (attempts < maxAttempts) {
    if (options.isCancelled()) {
      return { run, stoppedReason: 'cancelled', attempts };
    }
    run = await viewRun(executor, id);
    attempts += 1;
    if (isRunComplete(run)) {
      return { run, stoppedReason: 'complete', attempts };
    }
    if (options.isCancelled()) {
      return { run, stoppedReason: 'cancelled', attempts };
    }
    const delay = backoff[Math.min(attempts - 1, backoff.length - 1)] ?? 30_000;
    await sleep(delay);
  }
  return { run, stoppedReason: 'max-attempts', attempts };
}

/** Raw log text (not colored UI chrome — this is the actual job output, spec 14.5's exception for genuine log content). */
export function runLogArgs(id: number): string[] {
  return ['run', 'view', String(id), '--log'];
}

export async function fetchRunLog(executor: GhExecutor, id: number): Promise<string> {
  const result = await runGh(executor, runLogArgs(id));
  return result.stdout;
}

export function runDownloadArgs(id: number, destinationDir: string, artifactName?: string): string[] {
  const args = ['run', 'download', String(id), '--dir', destinationDir];
  if (artifactName) args.push('--name', artifactName);
  return args;
}

export async function downloadRunArtifacts(executor: GhExecutor, id: number, destinationDir: string, artifactName?: string): Promise<void> {
  await runGh(executor, runDownloadArgs(id, destinationDir, artifactName));
}

export function runCancelArgs(id: number): string[] {
  return ['run', 'cancel', String(id)];
}

export async function cancelRun(executor: GhExecutor, id: number): Promise<void> {
  await runGh(executor, runCancelArgs(id));
}

export function runRerunArgs(id: number, failedOnly: boolean): string[] {
  const args = ['run', 'rerun', String(id)];
  if (failedOnly) args.push('--failed');
  return args;
}

export async function rerunRun(executor: GhExecutor, id: number, failedOnly: boolean): Promise<void> {
  await runGh(executor, runRerunArgs(id, failedOnly));
}

// Re-exported for callers building an "obtainable, but not fatal if missing" report alongside auth.ts's pattern.
export async function tryListWorkflows(executor: GhExecutor): Promise<WorkflowSummary[] | null> {
  return runGhJsonOptional<WorkflowSummary[]>(executor, workflowListArgs());
}
