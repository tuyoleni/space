/**
 * Main-process wiring for M8's automation engine (spec section 18).
 * Mirrors agent-handlers.ts's shape exactly: `@space/automation`'s
 * `AutomationEngine` is pure and injected-everything; this file binds it
 * to real storage (via the `StorageCaller` RPC to the storage worker,
 * ADR-003) and to the exact same already-existing, already-tested M4/M5/M6
 * handlers every other surface uses — `gitHandlers.fetch` for
 * `fetchRepository`, `githubHandlers.actionsTrigger` for
 * `triggerGithubWorkflow`, and the same script-execution primitive
 * (`workspace-runner`'s `runProcess` + package-manager detection)
 * agent-handlers.ts's `runScript` already uses for
 * `runApprovedScript`/`runTests`. No new parallel implementation of any
 * capability lives here.
 */
import { randomUUID } from 'node:crypto';
import {
  AutomationEngine,
  inScopeAutomations,
  isScheduledAutomationDue,
  parseAutomationDefinition,
  type Automation,
  type AutomationActionHandlers,
  type AutomationKillSwitch,
  type AutomationRun,
  type AutomationRunRecorder,
  type AutomationStandingPermissionLookup,
  type AutomationTriggerEvent,
} from '@space/automation';
import { assertTrusted, type AgentStandingPermission } from '@space/domain';
import { runProcess, type ExecutableResolver } from '@space/workspace-runner';
import type { GitFetchInput, JsPackageManagerId, Project } from '@space/contracts';
import { buildSpaceEnvironment } from './environment-policy';
import type { GitHandlers } from './git-handlers';
import type { GithubHandlers } from './github-handlers';
import { recordOperation, type StorageCaller } from './project-handlers';

/** The subset of ProjectHandlers this file actually calls — narrow by design, same reasoning as agent-handlers.ts's `AgentProjectHandlersDependency`. */
export interface AutomationProjectHandlersDependency {
  detectPackageManager(input: { readonly canonicalPath: string }): Promise<{ readonly packageManager: JsPackageManagerId | null }>;
}

export interface AutomationHandlersOptions {
  readonly gitHandlers: GitHandlers;
  readonly githubHandlers: GithubHandlers;
  readonly projectHandlers: AutomationProjectHandlersDependency;
  readonly resolveExecutable?: ExecutableResolver;
  /** Real desktop notification delivery is out of this milestone's scope — defaults to a no-op; every `notifyUser` call still leaves a real receipt regardless. */
  readonly notify?: (message: string) => void;
}

interface AutomationRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly trigger: unknown;
  readonly conditions: readonly unknown[];
  readonly actions: readonly unknown[];
  readonly enabled: boolean;
  readonly lastExecutionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface AgentPermissionRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly actionType: string;
  readonly grantedAt: string;
  readonly revokedAt: string | null;
}

function toAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    name: row.name,
    trigger: row.trigger as Automation['trigger'],
    conditions: row.conditions as Automation['conditions'],
    actions: row.actions as Automation['actions'],
    enabled: row.enabled,
    lastExecutionId: row.lastExecutionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toStandingPermission(row: AgentPermissionRow): AgentStandingPermission {
  return {
    actionType: row.actionType,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    grantedAt: row.grantedAt,
    revoked: row.revokedAt !== null,
  };
}

const passthroughResolver: ExecutableResolver = async (executableId) => executableId;

export function createAutomationHandlers(storage: StorageCaller, options: AutomationHandlersOptions) {
  const resolveExecutable = options.resolveExecutable ?? passthroughResolver;
  const { gitHandlers, githubHandlers, projectHandlers } = options;
  const notify = options.notify ?? (() => undefined);

  async function requireProject(projectId: string): Promise<Project> {
    return storage.call<Project>('project.get', { projectId });
  }

  async function createAutomation(input: {
    readonly workspaceId: string;
    readonly projectId: string | null;
    readonly name: string;
    readonly trigger: unknown;
    readonly conditions: readonly unknown[];
    readonly actions: readonly unknown[];
  }): Promise<Automation> {
    // Untrusted (renderer-authored) input — validated once, here, before it
    // is ever persisted (mirrors parseAgentActionPlan's role for M7).
    const definition = parseAutomationDefinition(input);
    const row = await storage.call<AutomationRow>('automation.create', {
      id: randomUUID(),
      ...definition,
      createdAt: new Date().toISOString(),
    });
    return toAutomation(row);
  }

  async function listAutomations(workspaceId: string): Promise<Automation[]> {
    const rows = await storage.call<AutomationRow[]>('automation.list', { workspaceId });
    return rows.map(toAutomation);
  }

  async function setEnabled(id: string, enabled: boolean): Promise<Automation> {
    const row = await storage.call<AutomationRow>('automation.setEnabled', { id, enabled, updatedAt: new Date().toISOString() });
    return toAutomation(row);
  }

  async function deleteAutomation(id: string): Promise<void> {
    await storage.call('automation.delete', { id });
  }

  async function getAllEnabled(workspaceId: string): Promise<boolean> {
    return storage.call<boolean>('automationSettings.isAllEnabled', { workspaceId });
  }

  /** The instant kill switch's write side (spec 18.4) — a single call, no confirmation gate of its own, because disabling automation can never itself be an unsafe action. */
  async function setAllEnabled(workspaceId: string, enabled: boolean): Promise<void> {
    await storage.call('automationSettings.setAllEnabled', { workspaceId, enabled, updatedAt: new Date().toISOString() });
  }

  async function listRuns(automationId: string, limit?: number): Promise<AutomationRun[]> {
    return storage.call<AutomationRun[]>('automationRun.listByAutomation', { automationId, limit });
  }

  const runRecorder: AutomationRunRecorder = {
    async startRun(input) {
      return storage.call<AutomationRun>('automationRun.start', {
        id: randomUUID(),
        automationId: input.automationId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        triggerType: input.triggerEvent.type,
        triggerEvent: input.triggerEvent,
        startedAt: input.startedAt,
      });
    },
    async completeRun(runId, completion) {
      const run = await storage.call<AutomationRun>('automationRun.complete', {
        id: runId,
        state: completion.state,
        endedAt: completion.endedAt,
        failureReason: completion.failureReason ?? null,
        attempts: completion.attempts,
      });
      await storage.call('automation.setLastExecutionId', { id: run.automationId, lastExecutionId: run.id, updatedAt: completion.endedAt });
      // Every run leaves an activity trace too (spec 17.1's 'automation-execution'
      // category) via the same operation->activity mapping every other
      // mutating surface uses — a run is only activity-worthy once it has
      // actually finished, same reasoning as `activityEventFromOperation`.
      await recordOperation(storage, {
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        type: 'automation.run',
        humanSummary: `Automation run ${completion.state}`,
        startedAt: run.startedAt,
        state: completion.state === 'succeeded' ? 'succeeded' : 'failed',
        exitCode: completion.state === 'succeeded' ? 0 : 1,
        ...(completion.failureReason ? { partialState: { error: completion.failureReason } } : {}),
      });
      return run;
    },
  };

  const standingPermissions: AutomationStandingPermissionLookup = {
    async findActiveGrant(workspaceId, projectId, actionType) {
      const row = await storage.call<AgentPermissionRow | null>('agentPermission.findActiveGrant', {
        workspaceId,
        projectId,
        actionType,
      });
      return row ? toStandingPermission(row) : null;
    },
  };

  const killSwitch: AutomationKillSwitch = {
    isAllEnabled: (workspaceId) => getAllEnabled(workspaceId),
  };

  const actionHandlers: AutomationActionHandlers = {
    async runApprovedScript(_action, params) {
      // No project scope is threaded through AutomationAction itself (an
      // automation is already scoped at the automation level) — the
      // engine dispatches per-automation, so the project id is closed
      // over via `handleTriggerEvent`'s automation argument instead. See
      // `runScriptForAutomation` below, which every script-shaped action
      // handler delegates to.
      throw new Error(`runApprovedScript "${params.scriptName}" must be dispatched via runScriptForAutomation`);
    },
    async runTests() {
      throw new Error('runTests must be dispatched via runScriptForAutomation');
    },
    async fetchRepository(_action, _params) {
      throw new Error('fetchRepository must be dispatched via fetchForAutomation');
    },
    async notifyUser(_action, params) {
      notify(params.message);
      return { delivered: true, message: params.message };
    },
    async preparePrDescription(_action, params) {
      // "Prepare, but not silently publish" (spec 18.3) — this returns a
      // draft only; nothing in this handler ever calls
      // githubHandlers.prCreate or any other publish capability.
      const draft = `## ${params.title}\n\nAutomated draft prepared for \`${params.head}\` -> \`${params.base}\`. Review and edit before opening a real pull request.`;
      return { draft, reviewed: false };
    },
    async triggerGithubWorkflow(_action, _params) {
      throw new Error('triggerGithubWorkflow must be dispatched via triggerWorkflowForAutomation');
    },
    async openReceiptOrView(_action, params) {
      return { operationId: params.operationId ?? null, view: params.view ?? null };
    },
  };

  /**
   * Per-automation action handlers, closed over the automation's own
   * workspace/project scope (spec 18.4: "automations inherit workspace and
   * project boundaries") — built fresh for each run rather than threading
   * project id through every `AutomationAction`, since V1's actions never
   * need to name a *different* project than the automation they belong to.
   */
  function handlersFor(automation: Automation): AutomationActionHandlers {
    return {
      ...actionHandlers,
      async runApprovedScript(_action, params) {
        return runScriptForAutomation(automation, params.scriptName);
      },
      async runTests(_action, params) {
        return runScriptForAutomation(automation, params.scriptName ?? 'test');
      },
      async fetchRepository(_action, params) {
        if (!automation.projectId) {
          throw new Error(`Automation "${automation.name}" has no project scope — fetchRepository requires one`);
        }
        const input: GitFetchInput = { projectId: automation.projectId, ...(params.remoteName !== undefined ? { remoteName: params.remoteName } : {}) };
        return gitHandlers.fetch(input);
      },
      async triggerGithubWorkflow(_action, params) {
        // The standing-permission check already ran inside
        // `dispatchAutomationAction` before this handler is ever called —
        // that grant *is* the "explicit permission" spec 18.3 requires, so
        // `confirmed: true` here is not a bypass of githubHandlers' own
        // gate, it is what satisfies it.
        return githubHandlers.actionsTrigger(automation.workspaceId, params.workflow, params.ref, params.inputs ?? {}, true);
      },
    };
  }

  async function runScriptForAutomation(automation: Automation, scriptName: string): Promise<unknown> {
    if (!automation.projectId) {
      throw new Error(`Automation "${automation.name}" has no project scope — ${scriptName} requires one`);
    }
    const project = await requireProject(automation.projectId);
    // Same structural trust gate every other script-execution path uses
    // (spec 10.3/ADR-006) — an automation never gets a bypass a human
    // action wouldn't also need.
    assertTrusted({ trustState: project.trustState, operation: 'automation-script' });
    const detection = await projectHandlers.detectPackageManager({ canonicalPath: project.canonicalPath });
    const packageManager: JsPackageManagerId = detection.packageManager ?? 'npm';
    const startedAt = new Date().toISOString();
    const receipt = await runProcess(
      {
        operationId: randomUUID(),
        workspaceId: project.workspaceId,
        projectId: project.id,
        executableId: packageManager,
        args: ['run', scriptName],
        cwd: project.canonicalPath,
        env: buildSpaceEnvironment(),
      },
      { resolveExecutable },
    );
    await recordOperation(storage, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      type: 'automation.project.runScript',
      humanSummary: `Automation "${automation.name}" ran "${packageManager} run ${scriptName}" in "${project.name}"`,
      startedAt,
      state: receipt.state === 'succeeded' ? 'succeeded' : 'failed',
      exitCode: receipt.exitCode,
      ...(receipt.state === 'succeeded' ? {} : { partialState: { stderr: receipt.stderr } }),
    });
    if (receipt.state !== 'succeeded') {
      throw new Error(`Script "${scriptName}" failed with exit code ${receipt.exitCode}`);
    }
    return receipt;
  }

  /**
   * Runs one automation for one event through a freshly-scoped engine
   * (spec 18.4's action-handler project scoping) — the one code path both
   * `handleTriggerEvent` and `runDueScheduledAutomations` funnel through,
   * so there is exactly one place that constructs `AutomationEngine`. An
   * optional `now` is threaded straight into the engine's own clock so the
   * run receipt this produces (`startedAt`/`endedAt`) is stamped with the
   * *same* instant the caller used to decide whether to run it at all —
   * `runDueScheduledAutomations` relies on this: the run it just wrote
   * must be consistent with the `now` its own next due-check will compare
   * against, not a few milliseconds of real-clock drift later.
   */
  async function runOneAutomation(automation: Automation, event: AutomationTriggerEvent, now?: () => string): Promise<AutomationRun | null> {
    const scopedEngine = new AutomationEngine({
      handlers: handlersFor(automation),
      runs: runRecorder,
      standingPermissions,
      killSwitch,
      ...(now ? { now } : {}),
    });
    const outcome = await scopedEngine.runAutomation(automation, event);
    return outcome.ran ? outcome.run : null;
  }

  /**
   * The entry point every event-shaped trigger source calls (spec 18.2's
   * six event-driven triggers, each wired at its own already-existing
   * emission point — see ipc.ts's git-commit/git-push/project-opened
   * hooks and project-handlers.ts's dev-process exit callback for the
   * live examples wired in this milestone). Loads every automation in
   * scope for the event's workspace, narrows to enabled + in-scope
   * (trigger type, workspace, project) — deliberately *not*
   * pre-filtering by condition, so `AutomationEngine` itself evaluates
   * conditions and can write a `skipped-conditions` receipt when they
   * fail, rather than silently dropping the event — and runs each one
   * sequentially, so two automations reacting to the same event never
   * race each other's writes.
   */
  async function handleTriggerEvent(event: AutomationTriggerEvent): Promise<readonly AutomationRun[]> {
    const rows = await storage.call<AutomationRow[]>('automation.list', { workspaceId: event.workspaceId });
    const automations = inScopeAutomations(rows.map(toAutomation), event);
    const results: AutomationRun[] = [];
    for (const automation of automations) {
      const run = await runOneAutomation(automation, event);
      if (run) {
        results.push(run);
      }
    }
    return results;
  }

  /**
   * Drives the seventh trigger, `scheduled` (spec 18.2's "Scheduled time
   * while app is running") — unlike the other six, this one has no
   * external event to react to, so a caller (main.ts) invokes this
   * periodically on a plain interval for as long as the app process is
   * alive. There is deliberately no OS-level/background scheduler (spec
   * 18.5 explicitly defers that to the later GitHub App phase) — a due
   * check that never runs while the app is closed is the correct V1
   * behaviour, not a shortfall. Reuses `isScheduledAutomationDue` (already
   * pure-tested in `@space/automation`) and `runOneAutomation` (the same
   * engine construction every other trigger uses) — no parallel execution
   * path.
   */
  async function runDueScheduledAutomations(now: Date = new Date()): Promise<readonly AutomationRun[]> {
    const workspaces = await storage.call<ReadonlyArray<{ readonly id: string }>>('workspace.list', undefined);
    const results: AutomationRun[] = [];
    for (const workspace of workspaces) {
      const rows = await storage.call<AutomationRow[]>('automation.list', { workspaceId: workspace.id });
      for (const row of rows) {
        const automation = toAutomation(row);
        if (automation.trigger.type !== 'scheduled') {
          continue;
        }
        const recentRuns = await storage.call<Array<{ readonly startedAt: string }>>('automationRun.listByAutomation', {
          automationId: automation.id,
          limit: 1,
        });
        const lastRunStartedAt = recentRuns[0]?.startedAt ?? null;
        if (!isScheduledAutomationDue(automation, now, lastRunStartedAt)) {
          continue;
        }
        const event: AutomationTriggerEvent = {
          type: 'scheduled',
          workspaceId: automation.workspaceId,
          projectId: automation.projectId,
          occurredAt: now.toISOString(),
          context: {},
        };
        const run = await runOneAutomation(automation, event, () => now.toISOString());
        if (run) {
          results.push(run);
        }
      }
    }
    return results;
  }

  return {
    createAutomation,
    listAutomations,
    setEnabled,
    deleteAutomation,
    getAllEnabled,
    setAllEnabled,
    listRuns,
    handleTriggerEvent,
    runDueScheduledAutomations,
  };
}

export type AutomationHandlers = ReturnType<typeof createAutomationHandlers>;
