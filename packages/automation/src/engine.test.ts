import { describe, expect, it, vi } from 'vitest';
import { AutomationEngine, type AutomationRunRecorder, type AutomationStandingPermissionLookup, type AutomationKillSwitch } from './engine';
import type { AutomationActionHandlers } from './dispatch';
import type { Automation, AutomationRun } from './model';
import type { AutomationTriggerEvent } from './trigger-matching';

function baseAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    workspaceId: 'ws-1',
    projectId: null,
    name: 'Test automation',
    trigger: { type: 'commit-created' },
    conditions: [],
    actions: [{ id: 'a1', type: 'notifyUser', parameters: { message: 'x' } }],
    enabled: true,
    lastExecutionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function baseEvent(overrides: Partial<AutomationTriggerEvent> = {}): AutomationTriggerEvent {
  return {
    type: 'commit-created',
    workspaceId: 'ws-1',
    projectId: null,
    occurredAt: '2026-01-01T00:00:00.000Z',
    context: {},
    ...overrides,
  };
}

function fakeRecorder(): AutomationRunRecorder & { runs: AutomationRun[] } {
  const runs: AutomationRun[] = [];
  return {
    runs,
    async startRun(input) {
      const run: AutomationRun = {
        id: `run-${runs.length + 1}`,
        automationId: input.automationId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        triggerType: input.triggerEvent.type,
        state: 'running',
        startedAt: input.startedAt,
        endedAt: null,
        operationId: null,
        failureReason: null,
        attempts: 0,
      };
      runs.push(run);
      return run;
    },
    async completeRun(runId, completion) {
      const index = runs.findIndex((r) => r.id === runId);
      const updated: AutomationRun = {
        ...(runs[index] as AutomationRun),
        state: completion.state,
        endedAt: completion.endedAt,
        failureReason: completion.failureReason ?? null,
        attempts: completion.attempts,
      };
      runs[index] = updated;
      return updated;
    },
  };
}

function alwaysEnabled(): AutomationKillSwitch {
  return { isAllEnabled: async () => true };
}

function noStandingPermissions(): AutomationStandingPermissionLookup {
  return { findActiveGrant: async () => null };
}

function noopHandlers(overrides: Partial<AutomationActionHandlers> = {}): AutomationActionHandlers {
  const fail = vi.fn(async () => {
    throw new Error('handler should not have been called');
  });
  return {
    runApprovedScript: fail,
    runTests: fail,
    fetchRepository: fail,
    notifyUser: fail,
    preparePrDescription: fail,
    triggerGithubWorkflow: fail,
    openReceiptOrView: fail,
    ...overrides,
  };
}

describe('AutomationEngine.runAutomation', () => {
  it('does not run and writes no receipt for a non-matching event', async () => {
    const recorder = fakeRecorder();
    const engine = new AutomationEngine({
      handlers: noopHandlers(),
      runs: recorder,
      standingPermissions: noStandingPermissions(),
      killSwitch: alwaysEnabled(),
    });
    const automation = baseAutomation({ trigger: { type: 'branch-pushed' } });

    const outcome = await engine.runAutomation(automation, baseEvent({ type: 'commit-created' }));
    expect(outcome).toEqual({ ran: false, reason: 'not-matched' });
    expect(recorder.runs).toHaveLength(0);
  });

  it('an in-scope automation whose conditions fail for this event still writes a skipped-conditions receipt, without calling any action handler', async () => {
    const notifyUser = vi.fn(async () => ({ delivered: true }));
    const recorder = fakeRecorder();
    const engine = new AutomationEngine({
      handlers: noopHandlers({ notifyUser }),
      runs: recorder,
      standingPermissions: noStandingPermissions(),
      killSwitch: alwaysEnabled(),
    });
    const automation = baseAutomation({ conditions: [{ field: 'branch', operator: 'equals', value: 'main' }] });

    const outcome = await engine.runAutomation(automation, baseEvent({ context: { branch: 'dev' } }));
    expect(outcome.ran).toBe(true);
    if (outcome.ran) {
      expect(outcome.run.state).toBe('skipped-conditions');
    }
    expect(notifyUser).not.toHaveBeenCalled();
    expect(recorder.runs).toHaveLength(1);
  });

  it('runs normally when an in-scope automation\'s conditions do pass', async () => {
    const notifyUser = vi.fn(async () => ({ delivered: true }));
    const recorder = fakeRecorder();
    const engine = new AutomationEngine({
      handlers: noopHandlers({ notifyUser }),
      runs: recorder,
      standingPermissions: noStandingPermissions(),
      killSwitch: alwaysEnabled(),
    });
    const automation = baseAutomation({ conditions: [{ field: 'branch', operator: 'equals', value: 'main' }] });

    const outcome = await engine.runAutomation(automation, baseEvent({ context: { branch: 'main' } }));
    expect(outcome.ran).toBe(true);
    if (outcome.ran) {
      expect(outcome.run.state).toBe('succeeded');
    }
    expect(notifyUser).toHaveBeenCalledTimes(1);
  });

  it('the kill switch stops a run before any action handler is called, and still writes a receipt', async () => {
    const notifyUser = vi.fn(async () => ({ delivered: true }));
    const recorder = fakeRecorder();
    const engine = new AutomationEngine({
      handlers: noopHandlers({ notifyUser }),
      runs: recorder,
      standingPermissions: noStandingPermissions(),
      killSwitch: { isAllEnabled: async () => false },
    });

    const outcome = await engine.runAutomation(baseAutomation(), baseEvent());
    expect(outcome.ran).toBe(true);
    if (outcome.ran) {
      expect(outcome.run.state).toBe('skipped-disabled');
    }
    expect(notifyUser).not.toHaveBeenCalled();
    expect(recorder.runs).toHaveLength(1);
  });

  it('the kill switch is re-checked before every action, stopping a multi-action run immediately once flipped mid-run', async () => {
    let enabled = true;
    const notifyUser = vi.fn(async (_action: unknown, _params: unknown) => ({ delivered: true }));
    const runTests = vi.fn(async () => ({ passed: true }));
    const recorder = fakeRecorder();
    const engine = new AutomationEngine({
      handlers: noopHandlers({
        notifyUser: vi.fn(async (action, params) => {
          enabled = false; // simulate the user disabling automations mid-run
          return notifyUser(action, params);
        }),
        runTests,
      }),
      runs: recorder,
      standingPermissions: noStandingPermissions(),
      killSwitch: { isAllEnabled: async () => enabled },
    });
    const automation = baseAutomation({
      actions: [
        { id: 'a1', type: 'notifyUser', parameters: { message: 'first' } },
        { id: 'a2', type: 'runTests', parameters: {} },
      ],
    });

    const outcome = await engine.runAutomation(automation, baseEvent());
    expect(outcome.ran).toBe(true);
    if (outcome.ran) {
      expect(outcome.run.state).toBe('skipped-disabled');
    }
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(runTests).not.toHaveBeenCalled(); // never reached — the kill switch stopped the run between actions
  });

  it('bounds retries for a permanently failing action and never loops indefinitely', async () => {
    const attempts: number[] = [];
    const alwaysFails = vi.fn(async () => {
      attempts.push(Date.now());
      throw new Error('simulated permanent failure');
    });
    const recorder = fakeRecorder();
    const engine = new AutomationEngine({
      handlers: noopHandlers({ runTests: alwaysFails }),
      runs: recorder,
      standingPermissions: noStandingPermissions(),
      killSwitch: alwaysEnabled(),
      retryPolicy: { maxAttempts: 3, backoffMs: [0, 0, 0] },
      sleep: async () => undefined,
    });
    const automation = baseAutomation({ actions: [{ id: 'a1', type: 'runTests', parameters: {} }] });

    const outcome = await engine.runAutomation(automation, baseEvent());

    expect(alwaysFails).toHaveBeenCalledTimes(3); // exactly maxAttempts — proves the bound, not an infinite loop
    expect(outcome.ran).toBe(true);
    if (outcome.ran) {
      expect(outcome.run.state).toBe('failed');
      expect(outcome.run.attempts).toBe(3);
      expect(outcome.run.failureReason).toContain('simulated permanent failure');
    }
  });

  it('stops at the first unrecoverable action failure and never runs later ordered actions', async () => {
    const runTests = vi.fn(async () => {
      throw new Error('tests failed');
    });
    const openReceiptOrView = vi.fn(async () => ({ opened: true }));
    const recorder = fakeRecorder();
    const engine = new AutomationEngine({
      handlers: noopHandlers({ runTests, openReceiptOrView }),
      runs: recorder,
      standingPermissions: noStandingPermissions(),
      killSwitch: alwaysEnabled(),
      retryPolicy: { maxAttempts: 1, backoffMs: [0] },
      sleep: async () => undefined,
    });
    const automation = baseAutomation({
      actions: [
        { id: 'a1', type: 'runTests', parameters: {} },
        { id: 'a2', type: 'openReceiptOrView', parameters: { view: 'activity' } },
      ],
    });

    const outcome = await engine.runAutomation(automation, baseEvent());
    expect(outcome.ran).toBe(true);
    if (outcome.ran) {
      expect(outcome.run.state).toBe('failed');
    }
    expect(openReceiptOrView).not.toHaveBeenCalled();
  });

  it('runs every ordered action and marks the run succeeded', async () => {
    const calls: string[] = [];
    const runTests = vi.fn(async () => {
      calls.push('runTests');
      return { passed: true };
    });
    const notifyUser = vi.fn(async () => {
      calls.push('notifyUser');
      return { delivered: true };
    });
    const recorder = fakeRecorder();
    const engine = new AutomationEngine({
      handlers: noopHandlers({ runTests, notifyUser }),
      runs: recorder,
      standingPermissions: noStandingPermissions(),
      killSwitch: alwaysEnabled(),
    });
    const automation = baseAutomation({
      actions: [
        { id: 'a1', type: 'runTests', parameters: {} },
        { id: 'a2', type: 'notifyUser', parameters: { message: 'done' } },
      ],
    });

    const outcome = await engine.runAutomation(automation, baseEvent());
    expect(calls).toEqual(['runTests', 'notifyUser']);
    expect(outcome.ran).toBe(true);
    if (outcome.ran) {
      expect(outcome.run.state).toBe('succeeded');
      expect(outcome.run.attempts).toBe(2);
    }
  });

  it('an unpermitted remote action fails the run without ever reaching the handler, proving destructive/remote actions cannot be silently automated', async () => {
    const triggerGithubWorkflow = vi.fn(async () => ({ triggered: true }));
    const recorder = fakeRecorder();
    const engine = new AutomationEngine({
      handlers: noopHandlers({ triggerGithubWorkflow }),
      runs: recorder,
      standingPermissions: noStandingPermissions(), // no grant exists
      killSwitch: alwaysEnabled(),
      retryPolicy: { maxAttempts: 1, backoffMs: [0] },
    });
    const automation = baseAutomation({
      actions: [{ id: 'a1', type: 'triggerGithubWorkflow', parameters: { workflow: 'ci.yml', ref: 'main' } }],
    });

    const outcome = await engine.runAutomation(automation, baseEvent());
    expect(triggerGithubWorkflow).not.toHaveBeenCalled();
    expect(outcome.ran).toBe(true);
    if (outcome.ran) {
      expect(outcome.run.state).toBe('failed');
    }
  });
});
