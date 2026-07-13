/**
 * The typed agent action plan (spec 19.1) and its Zod validation boundary.
 * "Model output is untrusted input and must pass schema validation"
 * (spec 19.3) — nothing downstream of `parseAgentActionPlan` ever sees a
 * plan that hasn't been checked against this schema first, and
 * `parameters` stays `unknown` on the public `AgentAction` type exactly as
 * spec 19.1 shows it; per-type parameter schemas below are what the
 * dispatcher (spec 19.1: "every action is validated and translated by
 * trusted application code") uses to narrow `parameters` safely before
 * calling a real capability.
 */
import { z } from 'zod';
import type { AgentActionRisk } from '@space/domain';

export const AGENT_ACTION_TYPES = [
  'file.read',
  'file.modify',
  'project.installDependencies',
  'project.runScript',
  'git.stage',
  'git.commit',
  'git.push',
  'github.createPullRequest',
] as const;

export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];

export interface AgentAction {
  readonly id: string;
  readonly type: AgentActionType;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly parameters: unknown;
  readonly explanation: string;
  readonly risk: AgentActionRisk;
}

const RiskSchema = z.enum(['observe', 'local-reversible', 'remote', 'destructive']);

const BaseFields = {
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  explanation: z.string().min(1),
  risk: RiskSchema,
};

export const FileReadParamsSchema = z.object({ path: z.string().min(1) });
export const FileModifyParamsSchema = z.object({ patchText: z.string().min(1), allowOnce: z.boolean().optional() });
export const InstallDependenciesParamsSchema = z.object({
  packageManager: z.enum(['npm', 'yarn', 'pnpm']).optional(),
  allowOnce: z.boolean().optional(),
});
export const RunScriptParamsSchema = z.object({ scriptName: z.string().min(1), allowOnce: z.boolean().optional() });
export const GitStageParamsSchema = z.object({ paths: z.array(z.string().min(1)).min(1) });
export const GitCommitParamsSchema = z.object({ message: z.string().min(1) });
export const GitPushParamsSchema = z.object({
  branch: z.string().min(1),
  remoteName: z.string().min(1).optional(),
  setUpstream: z.boolean().optional(),
  force: z.enum(['none', 'with-lease', 'raw']).optional(),
  confirmed: z.boolean().optional(),
});
/** Mirrors @space/github-engine's PullRequestCreateInput field-for-field, without importing it — this is a validation boundary for untrusted input, not a re-export of a trusted internal type. */
export const CreatePullRequestParamsSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  base: z.string().min(1),
  head: z.string().min(1),
  draft: z.boolean().optional(),
  reviewers: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  host: z.string().optional(),
  confirmed: z.boolean().optional(),
});

export const AgentActionSchema = z.discriminatedUnion('type', [
  z.object({ ...BaseFields, type: z.literal('file.read'), parameters: FileReadParamsSchema }),
  z.object({ ...BaseFields, type: z.literal('file.modify'), parameters: FileModifyParamsSchema }),
  z.object({ ...BaseFields, type: z.literal('project.installDependencies'), parameters: InstallDependenciesParamsSchema }),
  z.object({ ...BaseFields, type: z.literal('project.runScript'), parameters: RunScriptParamsSchema }),
  z.object({ ...BaseFields, type: z.literal('git.stage'), parameters: GitStageParamsSchema }),
  z.object({ ...BaseFields, type: z.literal('git.commit'), parameters: GitCommitParamsSchema }),
  z.object({ ...BaseFields, type: z.literal('git.push'), parameters: GitPushParamsSchema }),
  z.object({ ...BaseFields, type: z.literal('github.createPullRequest'), parameters: CreatePullRequestParamsSchema }),
]);

export const AgentActionPlanSchema = z.array(AgentActionSchema);

export class InvalidAgentActionPlanError extends Error {
  constructor(public readonly issues: readonly z.ZodIssue[]) {
    super(`Agent action plan failed schema validation: ${issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    this.name = 'InvalidAgentActionPlanError';
  }
}

/**
 * The one entry point untrusted model output (or any other externally
 * produced plan) must pass through before anything in this codebase acts
 * on it (spec 19.3). Throws `InvalidAgentActionPlanError` rather than
 * silently dropping or coercing malformed entries — a plan is trusted as
 * a whole or not at all.
 */
export function parseAgentActionPlan(raw: unknown): AgentAction[] {
  const result = AgentActionPlanSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidAgentActionPlanError(result.error.issues);
  }
  return result.data;
}

export function parseAgentAction(raw: unknown): AgentAction {
  const result = AgentActionSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidAgentActionPlanError(result.error.issues);
  }
  return result.data;
}
