/**
 * The typed dispatch layer over already-existing, already-tested
 * capabilities (spec 19.1: "every action is validated and translated by
 * trusted application code"). This module contains no I/O of its own —
 * `AgentActionHandlers` is injected by the caller (apps/desktop's
 * agent-handlers.ts) and bound to the real M4/M5/M6 handlers
 * (installDependencies, git stage/commit/push, GitHub PR creation) that
 * already exist and are already tested against real fixtures/fakes. This
 * layer's job is narrow: recompute the action's true risk from its type
 * and parameters (never trust a model-supplied `risk` label at face
 * value, spec 25.3.6: "model output is data, never executable
 * authority"), pass that through the structural confirmation gate, and
 * only then hand typed, re-validated parameters to the matching handler.
 */
import { assertAgentActionConfirmed, type AgentActionRisk, type AgentStandingPermission } from '@space/domain';
import {
  AgentActionSchema,
  CreatePullRequestParamsSchema,
  FileModifyParamsSchema,
  FileReadParamsSchema,
  GitCommitParamsSchema,
  GitPushParamsSchema,
  GitStageParamsSchema,
  InstallDependenciesParamsSchema,
  RunScriptParamsSchema,
  type AgentAction,
} from './agent-action';

/**
 * The true risk of an action is derived from its type and parameters, not
 * copied from the (possibly model-authored, possibly wrong or
 * adversarial) `risk` field on the action itself — a plan claiming
 * `git.push` with `force: 'raw'` is destructive regardless of what label
 * it shipped with. This is the one function every dispatch path must call
 * before the confirmation gate.
 */
export function computeIntrinsicRisk(action: Pick<AgentAction, 'type' | 'parameters'>): AgentActionRisk {
  switch (action.type) {
    case 'file.read':
      return 'observe';
    case 'file.modify':
    case 'project.installDependencies':
    case 'project.runScript':
    case 'git.stage':
    case 'git.commit':
      return 'local-reversible';
    case 'git.push': {
      const params = GitPushParamsSchema.parse(action.parameters);
      return params.force === 'with-lease' || params.force === 'raw' ? 'destructive' : 'remote';
    }
    case 'github.createPullRequest':
      return 'remote';
    default: {
      const exhaustive: never = action.type;
      throw new Error(`Unknown agent action type: ${String(exhaustive)}`);
    }
  }
}

export interface AgentActionContext {
  readonly confirmed: boolean;
  readonly standingPermission?: AgentStandingPermission | null;
}

export interface AgentActionHandlers {
  fileRead(action: AgentAction, params: ReturnType<typeof FileReadParamsSchema.parse>): Promise<unknown>;
  fileModify(action: AgentAction, params: ReturnType<typeof FileModifyParamsSchema.parse>): Promise<unknown>;
  installDependencies(action: AgentAction, params: ReturnType<typeof InstallDependenciesParamsSchema.parse>): Promise<unknown>;
  runScript(action: AgentAction, params: ReturnType<typeof RunScriptParamsSchema.parse>): Promise<unknown>;
  gitStage(action: AgentAction, params: ReturnType<typeof GitStageParamsSchema.parse>): Promise<unknown>;
  gitCommit(action: AgentAction, params: ReturnType<typeof GitCommitParamsSchema.parse>): Promise<unknown>;
  gitPush(action: AgentAction, params: ReturnType<typeof GitPushParamsSchema.parse>): Promise<unknown>;
  githubCreatePullRequest(action: AgentAction, params: ReturnType<typeof CreatePullRequestParamsSchema.parse>): Promise<unknown>;
}

/**
 * Validates `action` (defence in depth — callers are expected to have
 * already run the whole plan through `parseAgentActionPlan`, but this
 * function never trusts that), recomputes its intrinsic risk, passes it
 * through `assertAgentActionConfirmed` (spec 19.2, 25.3.6 — this throws
 * before any handler runs for an unconfirmed destructive/remote action),
 * and only then calls the matching injected handler with typed
 * parameters. This function performs no I/O and no trust check of its
 * own beyond confirmation — `file.modify`/`project.runScript` handlers
 * are responsible for their own `assertTrusted` call (spec 10.3/ADR-006),
 * since only the handler (bound to a real project's trust state) can
 * evaluate that gate.
 */
export async function dispatchAgentAction(
  rawAction: unknown,
  handlers: AgentActionHandlers,
  context: AgentActionContext,
): Promise<unknown> {
  const action = AgentActionSchema.parse(rawAction) as AgentAction;
  const risk = computeIntrinsicRisk(action);
  assertAgentActionConfirmed({
    risk,
    confirmed: context.confirmed,
    standingPermission: context.standingPermission ?? null,
  });

  switch (action.type) {
    case 'file.read':
      return handlers.fileRead(action, FileReadParamsSchema.parse(action.parameters));
    case 'file.modify':
      return handlers.fileModify(action, FileModifyParamsSchema.parse(action.parameters));
    case 'project.installDependencies':
      return handlers.installDependencies(action, InstallDependenciesParamsSchema.parse(action.parameters));
    case 'project.runScript':
      return handlers.runScript(action, RunScriptParamsSchema.parse(action.parameters));
    case 'git.stage':
      return handlers.gitStage(action, GitStageParamsSchema.parse(action.parameters));
    case 'git.commit':
      return handlers.gitCommit(action, GitCommitParamsSchema.parse(action.parameters));
    case 'git.push':
      return handlers.gitPush(action, GitPushParamsSchema.parse(action.parameters));
    case 'github.createPullRequest':
      return handlers.githubCreatePullRequest(action, CreatePullRequestParamsSchema.parse(action.parameters));
    default: {
      const exhaustive: never = action.type;
      throw new Error(`Unknown agent action type: ${String(exhaustive)}`);
    }
  }
}
