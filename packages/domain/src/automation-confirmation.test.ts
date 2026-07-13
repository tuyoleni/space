import { describe, expect, it } from 'vitest';
import {
  AutomationActionNotPermittedError,
  assertAutomationActionConfirmed,
  checkAutomationActionConfirmation,
} from './automation-confirmation';
import type { AgentStandingPermission } from './agent-confirmation';

describe('checkAutomationActionConfirmation / assertAutomationActionConfirmed', () => {
  it('permits observe actions unconditionally', () => {
    expect(checkAutomationActionConfirmation({ risk: 'observe' }).permitted).toBe(true);
    expect(() => assertAutomationActionConfirmed({ risk: 'observe' })).not.toThrow();
  });

  it('permits local-reversible actions unconditionally (project trust is a separate gate)', () => {
    expect(checkAutomationActionConfirmation({ risk: 'local-reversible' }).permitted).toBe(true);
  });

  it('never permits a destructive automation action, unconditionally — there is no confirmed field to smuggle true through, and a standing permission does not help', () => {
    expect(checkAutomationActionConfirmation({ risk: 'destructive' }).permitted).toBe(false);
    const grant: AgentStandingPermission = {
      actionType: 'anything',
      workspaceId: 'ws-1',
      projectId: null,
      grantedAt: '2026-01-01T00:00:00.000Z',
      revoked: false,
    };
    expect(checkAutomationActionConfirmation({ risk: 'destructive', standingPermission: grant }).permitted).toBe(false);
    expect(() => assertAutomationActionConfirmed({ risk: 'destructive', standingPermission: grant })).toThrow(
      AutomationActionNotPermittedError,
    );
  });

  it('blocks a remote automation action with no standing permission', () => {
    expect(checkAutomationActionConfirmation({ risk: 'remote' }).permitted).toBe(false);
    expect(() => assertAutomationActionConfirmed({ risk: 'remote' })).toThrow(AutomationActionNotPermittedError);
  });

  it('permits a remote automation action via a live, non-revoked standing permission scoped to it', () => {
    const grant: AgentStandingPermission = {
      actionType: 'triggerGithubWorkflow',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      grantedAt: '2026-01-01T00:00:00.000Z',
      revoked: false,
    };
    expect(checkAutomationActionConfirmation({ risk: 'remote', standingPermission: grant }).permitted).toBe(true);
  });

  it('blocks a remote automation action once its standing permission is revoked', () => {
    const grant: AgentStandingPermission = {
      actionType: 'triggerGithubWorkflow',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      grantedAt: '2026-01-01T00:00:00.000Z',
      revoked: true,
    };
    expect(checkAutomationActionConfirmation({ risk: 'remote', standingPermission: grant }).permitted).toBe(false);
  });
});
