/**
 * The automation model (spec 18.1) and its Zod validation boundary. An
 * automation definition is untrusted input wherever it crosses an IPC
 * boundary (the renderer proposes it, same as an agent action plan) —
 * nothing downstream of `parseAutomationDefinition`/`parseAutomationAction`
 * ever sees an unvalidated shape, mirroring `@space/agent`'s
 * `parseAgentActionPlan` pattern exactly.
 *
 * Trigger set is exactly spec 18.2's seven; action set is exactly spec
 * 18.3's seven. Neither union includes anything destructive (no
 * force-push, branch-delete, merge, or release-publish action exists
 * here) — that omission is itself half of "destructive operations cannot
 * be fully automated in V1" (spec 18.4); the other half is
 * `@space/domain`'s `assertAutomationActionConfirmed`, which rejects a
 * `destructive`-risk action unconditionally regardless of any input field.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Triggers (spec 18.2 — exactly these seven, wired to signals that already
// exist: M5's repository watcher hint, M5's commit/push receipts, M6's
// check-polling, M4's dev-process exit events, and an app-runtime scheduler
// tick for "scheduled time while app is running").
// ---------------------------------------------------------------------------

export const AUTOMATION_TRIGGER_TYPES = [
  'project-opened',
  'repository-state-changed',
  'commit-created',
  'branch-pushed',
  'check-failed',
  'dev-process-exited',
  'scheduled',
] as const;

export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

const triggerTypeSchema = z.enum(AUTOMATION_TRIGGER_TYPES);

export const AutomationTriggerSchema = z.object({
  type: triggerTypeSchema,
  /** Only meaningful for `type: 'scheduled'` — how often, in minutes, this automation may fire while the app is running. */
  intervalMinutes: z.number().int().min(1).max(10_080).optional(),
});

export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>;

// ---------------------------------------------------------------------------
// Conditions: simple predicates evaluated against the normalised trigger
// event's context (spec 18.1's "Conditions" field). Deliberately minimal —
// spec 18 does not prescribe a condition language, and V1's trigger set is
// narrow enough that a flat field/operator/value predicate covers every
// realistic case (branch name, check name, script exit code, ...).
// ---------------------------------------------------------------------------

export const AUTOMATION_CONDITION_OPERATORS = ['equals', 'notEquals', 'contains', 'matches'] as const;
export type AutomationConditionOperator = (typeof AUTOMATION_CONDITION_OPERATORS)[number];

export const AutomationConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(AUTOMATION_CONDITION_OPERATORS),
  value: z.string(),
});

export type AutomationCondition = z.infer<typeof AutomationConditionSchema>;

// ---------------------------------------------------------------------------
// Actions (spec 18.3 — exactly these seven). Every handler this dispatches
// to is real, already-existing, already-tested M4/M5/M6/M7 capability —
// see `dispatch.ts`'s `AutomationActionHandlers`.
// ---------------------------------------------------------------------------

export const AUTOMATION_ACTION_TYPES = [
  'runApprovedScript',
  'runTests',
  'fetchRepository',
  'notifyUser',
  'preparePrDescription',
  'triggerGithubWorkflow',
  'openReceiptOrView',
] as const;

export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export const RunApprovedScriptParamsSchema = z.object({ scriptName: z.string().min(1) });
export const RunTestsParamsSchema = z.object({ scriptName: z.string().min(1).optional() });
export const FetchRepositoryParamsSchema = z.object({ remoteName: z.string().min(1).optional() });
export const NotifyUserParamsSchema = z.object({ message: z.string().min(1) });
/** "Prepare, but not silently publish" (spec 18.3) — this produces a draft only; no handler this maps to may ever call a real PR-create capability. */
export const PreparePrDescriptionParamsSchema = z.object({
  title: z.string().min(1),
  base: z.string().min(1),
  head: z.string().min(1),
});
export const TriggerGithubWorkflowParamsSchema = z.object({
  workflow: z.string().min(1),
  ref: z.string().min(1),
  inputs: z.record(z.string(), z.string()).optional(),
});
export const OpenReceiptOrViewParamsSchema = z.object({
  operationId: z.string().min(1).optional(),
  view: z.string().min(1).optional(),
});

const actionBase = { id: z.string().min(1) };

export const AutomationActionSchema = z.discriminatedUnion('type', [
  z.object({ ...actionBase, type: z.literal('runApprovedScript'), parameters: RunApprovedScriptParamsSchema }),
  z.object({ ...actionBase, type: z.literal('runTests'), parameters: RunTestsParamsSchema }),
  z.object({ ...actionBase, type: z.literal('fetchRepository'), parameters: FetchRepositoryParamsSchema }),
  z.object({ ...actionBase, type: z.literal('notifyUser'), parameters: NotifyUserParamsSchema }),
  z.object({ ...actionBase, type: z.literal('preparePrDescription'), parameters: PreparePrDescriptionParamsSchema }),
  z.object({ ...actionBase, type: z.literal('triggerGithubWorkflow'), parameters: TriggerGithubWorkflowParamsSchema }),
  z.object({ ...actionBase, type: z.literal('openReceiptOrView'), parameters: OpenReceiptOrViewParamsSchema }),
]);

/**
 * Hand-declared rather than `z.infer<typeof AutomationActionSchema>`
 * deliberately: `parameters: unknown` (not a per-variant union of parameter
 * shapes) is what lets a plain `switch (action.type)` narrow cleanly to
 * `never` in an exhaustiveness check (`dispatch.ts`'s default branch) —
 * exactly the same reasoning `@space/agent`'s hand-declared `AgentAction`
 * interface documents. The Zod schema above is the validation boundary;
 * this interface is the type callers actually program against.
 */
export interface AutomationAction {
  readonly id: string;
  readonly type: AutomationActionType;
  readonly parameters: unknown;
}

export class InvalidAutomationActionError extends Error {
  constructor(public readonly issues: readonly z.ZodIssue[]) {
    super(`Automation action failed schema validation: ${issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    this.name = 'InvalidAutomationActionError';
  }
}

export function parseAutomationAction(raw: unknown): AutomationAction {
  const result = AutomationActionSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidAutomationActionError(result.error.issues);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// The automation itself (spec 18.1: workspace owner, optional project
// scope, trigger, conditions, ordered actions, permission requirements,
// enabled state, last execution, execution history). "Permission
// requirements" and "execution history" are not fields on this object —
// permission requirements are derived per-action by `computeIntrinsicRisk`
// at dispatch time (never trusted from stored data, same reasoning as
// `AgentAction`'s risk field), and execution history is a separate,
// storage-owned append-only log (`AutomationRun`), not embedded here.
// ---------------------------------------------------------------------------

export const AutomationDefinitionSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  name: z.string().trim().min(1).max(200),
  trigger: AutomationTriggerSchema,
  conditions: z.array(AutomationConditionSchema),
  actions: z.array(AutomationActionSchema).min(1).max(20),
});

export type AutomationDefinition = z.infer<typeof AutomationDefinitionSchema>;

export interface Automation extends AutomationDefinition {
  readonly id: string;
  readonly enabled: boolean;
  readonly lastExecutionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function parseAutomationDefinition(raw: unknown): AutomationDefinition {
  return AutomationDefinitionSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Execution history (spec 18.1's "Execution history", 18.4's "each run
// produces a receipt"). One row per attempt to run an automation for one
// trigger event.
// ---------------------------------------------------------------------------

export type AutomationRunState = 'running' | 'succeeded' | 'failed' | 'skipped-disabled' | 'skipped-conditions';

export interface AutomationRun {
  readonly id: string;
  readonly automationId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly triggerType: AutomationTriggerType;
  readonly state: AutomationRunState;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly operationId: string | null;
  readonly failureReason: string | null;
  readonly attempts: number;
}

// ---------------------------------------------------------------------------
// Bounded retries (spec 18.4: "Failed automations use bounded retries and
// never loop indefinitely"). This is the one policy every action dispatch
// in `engine.ts` is retried under — a hard ceiling, not a convention.
// ---------------------------------------------------------------------------

export interface AutomationRetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs: readonly number[];
}

export const DEFAULT_AUTOMATION_RETRY_POLICY: AutomationRetryPolicy = {
  maxAttempts: 3,
  backoffMs: [1_000, 5_000, 15_000],
};
