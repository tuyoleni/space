import { describe, expect, it, vi } from 'vitest';
import { AutomationActionNotPermittedError, type AgentStandingPermission } from '@space/domain';
import { computeIntrinsicRisk, dispatchAutomationAction, type AutomationActionHandlers } from './dispatch';

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

describe('computeIntrinsicRisk', () => {
  it('classifies every V1 action type per spec 18.3/18.4, with none ever destructive', () => {
    expect(computeIntrinsicRisk({ type: 'notifyUser' })).toBe('observe');
    expect(computeIntrinsicRisk({ type: 'preparePrDescription' })).toBe('observe');
    expect(computeIntrinsicRisk({ type: 'openReceiptOrView' })).toBe('observe');
    expect(computeIntrinsicRisk({ type: 'runApprovedScript' })).toBe('local-reversible');
    expect(computeIntrinsicRisk({ type: 'runTests' })).toBe('local-reversible');
    expect(computeIntrinsicRisk({ type: 'fetchRepository' })).toBe('local-reversible');
    expect(computeIntrinsicRisk({ type: 'triggerGithubWorkflow' })).toBe('remote');
  });
});

describe('dispatchAutomationAction: structural safety gate', () => {
  it('permits observe/local-reversible actions with no standing permission', async () => {
    const notifyUser = vi.fn(async () => ({ delivered: true }));
    const handlers = noopHandlers({ notifyUser });
    const result = await dispatchAutomationAction({ id: '1', type: 'notifyUser', parameters: { message: 'hi' } }, handlers, {});
    expect(result).toEqual({ delivered: true });
  });

  it('rejects triggerGithubWorkflow (remote) with no standing permission, before the handler is ever called', async () => {
    const triggerGithubWorkflow = vi.fn(async () => ({ triggered: true }));
    const handlers = noopHandlers({ triggerGithubWorkflow });
    const action = { id: '1', type: 'triggerGithubWorkflow', parameters: { workflow: 'ci.yml', ref: 'main' } };

    await expect(dispatchAutomationAction(action, handlers, {})).rejects.toThrow(AutomationActionNotPermittedError);
    expect(triggerGithubWorkflow).not.toHaveBeenCalled();
  });

  it('permits triggerGithubWorkflow via a live standing permission scoped to that exact action', async () => {
    const triggerGithubWorkflow = vi.fn(async () => ({ triggered: true }));
    const handlers = noopHandlers({ triggerGithubWorkflow });
    const action = { id: '1', type: 'triggerGithubWorkflow', parameters: { workflow: 'ci.yml', ref: 'main' } };
    const grant: AgentStandingPermission = {
      actionType: 'triggerGithubWorkflow',
      workspaceId: 'ws-1',
      projectId: null,
      grantedAt: '2026-01-01T00:00:00.000Z',
      revoked: false,
    };

    const result = await dispatchAutomationAction(action, handlers, { standingPermission: grant });
    expect(result).toEqual({ triggered: true });
    expect(triggerGithubWorkflow).toHaveBeenCalledTimes(1);
  });

  it('rejects triggerGithubWorkflow once its standing permission is revoked', async () => {
    const triggerGithubWorkflow = vi.fn(async () => ({ triggered: true }));
    const handlers = noopHandlers({ triggerGithubWorkflow });
    const action = { id: '1', type: 'triggerGithubWorkflow', parameters: { workflow: 'ci.yml', ref: 'main' } };
    const grant: AgentStandingPermission = {
      actionType: 'triggerGithubWorkflow',
      workspaceId: 'ws-1',
      projectId: null,
      grantedAt: '2026-01-01T00:00:00.000Z',
      revoked: true,
    };

    await expect(dispatchAutomationAction(action, handlers, { standingPermission: grant })).rejects.toThrow(
      AutomationActionNotPermittedError,
    );
  });

  it('rejects a completely unknown/smuggled action type before it reaches any handler — there is no destructive action in this union to begin with', async () => {
    const handlers = noopHandlers();
    const malicious = { id: '1', type: 'git.push', parameters: { branch: 'main', force: 'raw' } };
    await expect(dispatchAutomationAction(malicious, handlers, {})).rejects.toThrow();
  });

  it('rejects malformed parameters before the handler runs', async () => {
    const notifyUser = vi.fn(async () => ({ delivered: true }));
    const handlers = noopHandlers({ notifyUser });
    await expect(dispatchAutomationAction({ id: '1', type: 'notifyUser', parameters: {} }, handlers, {})).rejects.toThrow();
    expect(notifyUser).not.toHaveBeenCalled();
  });
});
