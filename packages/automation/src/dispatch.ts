/**
 * The typed dispatch layer over already-existing, already-tested
 * capabilities (spec 18.3), mirroring `@space/agent`'s `dispatch.ts`
 * exactly: no I/O of its own, `AutomationActionHandlers` is injected by
 * the caller (apps/desktop's automation-handlers.ts) and bound to the real
 * M4/M5/M6/M7 handlers (project script execution, `git fetch`, GitHub
 * Actions dispatch, ...) that already exist and are already tested against
 * real fixtures/fakes. This layer recomputes each action's true risk from
 * its type (never trusts stored/model-supplied data as authority, same
 * reasoning as spec 25.3.6), passes it through the structural automation
 * confirmation gate (`@space/domain`'s `assertAutomationActionConfirmed`,
 * which has no `confirmed` escape hatch — see that module's header), and
 * only then hands typed, re-validated parameters to the matching handler.
 */
import { assertAutomationActionConfirmed, type AgentStandingPermission, type AutomationActionRisk } from '@space/domain';
import {
  AutomationActionSchema,
  FetchRepositoryParamsSchema,
  NotifyUserParamsSchema,
  OpenReceiptOrViewParamsSchema,
  PreparePrDescriptionParamsSchema,
  RunApprovedScriptParamsSchema,
  RunTestsParamsSchema,
  TriggerGithubWorkflowParamsSchema,
  type AutomationAction,
} from './model';

/** The true risk of an automation action, derived from its type alone — every V1 action type maps to a fixed risk (spec 18.3's action set never includes anything destructive, so `destructive` is never returned here; the confirmation gate still rejects it unconditionally as defence in depth). */
export function computeIntrinsicRisk(action: Pick<AutomationAction, 'type'>): AutomationActionRisk {
  switch (action.type) {
    case 'notifyUser':
    case 'preparePrDescription':
    case 'openReceiptOrView':
      return 'observe';
    case 'runApprovedScript':
    case 'runTests':
    case 'fetchRepository':
      return 'local-reversible';
    case 'triggerGithubWorkflow':
      return 'remote';
    default: {
      const exhaustive: never = action.type;
      throw new Error(`Unknown automation action type: ${String(exhaustive)}`);
    }
  }
}

export interface AutomationDispatchContext {
  /** A standing permission scoped to this exact workspace/project/action type — required for `remote`-risk actions, resolved by the caller before dispatch. */
  readonly standingPermission?: AgentStandingPermission | null;
}

export interface AutomationActionHandlers {
  runApprovedScript(action: AutomationAction, params: ReturnType<typeof RunApprovedScriptParamsSchema.parse>): Promise<unknown>;
  runTests(action: AutomationAction, params: ReturnType<typeof RunTestsParamsSchema.parse>): Promise<unknown>;
  fetchRepository(action: AutomationAction, params: ReturnType<typeof FetchRepositoryParamsSchema.parse>): Promise<unknown>;
  notifyUser(action: AutomationAction, params: ReturnType<typeof NotifyUserParamsSchema.parse>): Promise<unknown>;
  preparePrDescription(action: AutomationAction, params: ReturnType<typeof PreparePrDescriptionParamsSchema.parse>): Promise<unknown>;
  triggerGithubWorkflow(action: AutomationAction, params: ReturnType<typeof TriggerGithubWorkflowParamsSchema.parse>): Promise<unknown>;
  openReceiptOrView(action: AutomationAction, params: ReturnType<typeof OpenReceiptOrViewParamsSchema.parse>): Promise<unknown>;
}

/**
 * Validates `rawAction` (defence in depth — callers are expected to have
 * already validated the whole automation via `parseAutomationDefinition`,
 * but this never trusts that), recomputes its intrinsic risk, passes it
 * through `assertAutomationActionConfirmed` (this throws before any
 * handler runs for a `remote` action with no live standing permission, and
 * unconditionally for `destructive`), and only then calls the matching
 * injected handler with typed parameters.
 */
export async function dispatchAutomationAction(
  rawAction: unknown,
  handlers: AutomationActionHandlers,
  context: AutomationDispatchContext,
): Promise<unknown> {
  const action = AutomationActionSchema.parse(rawAction) as AutomationAction;
  const risk = computeIntrinsicRisk(action);
  assertAutomationActionConfirmed({ risk, standingPermission: context.standingPermission ?? null });

  switch (action.type) {
    case 'runApprovedScript':
      return handlers.runApprovedScript(action, RunApprovedScriptParamsSchema.parse(action.parameters));
    case 'runTests':
      return handlers.runTests(action, RunTestsParamsSchema.parse(action.parameters));
    case 'fetchRepository':
      return handlers.fetchRepository(action, FetchRepositoryParamsSchema.parse(action.parameters));
    case 'notifyUser':
      return handlers.notifyUser(action, NotifyUserParamsSchema.parse(action.parameters));
    case 'preparePrDescription':
      return handlers.preparePrDescription(action, PreparePrDescriptionParamsSchema.parse(action.parameters));
    case 'triggerGithubWorkflow':
      return handlers.triggerGithubWorkflow(action, TriggerGithubWorkflowParamsSchema.parse(action.parameters));
    case 'openReceiptOrView':
      return handlers.openReceiptOrView(action, OpenReceiptOrViewParamsSchema.parse(action.parameters));
    default: {
      const exhaustive: never = action.type;
      throw new Error(`Unknown automation action type: ${String(exhaustive)}`);
    }
  }
}
