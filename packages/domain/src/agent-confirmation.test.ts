import { describe, expect, it } from 'vitest';
import {
  AgentActionNotConfirmedError,
  assertAgentActionConfirmed,
  checkAgentActionConfirmation,
  revokeStandingPermission,
  type AgentStandingPermission,
} from './agent-confirmation';

describe('checkAgentActionConfirmation / assertAgentActionConfirmed', () => {
  it('permits observe actions unconditionally', () => {
    expect(checkAgentActionConfirmation({ risk: 'observe', confirmed: false }).permitted).toBe(true);
    expect(() => assertAgentActionConfirmed({ risk: 'observe', confirmed: false })).not.toThrow();
  });

  it('permits local-reversible actions unconditionally (project trust is a separate gate)', () => {
    expect(checkAgentActionConfirmation({ risk: 'local-reversible', confirmed: false }).permitted).toBe(true);
  });

  it('blocks a destructive action that is not confirmed, before it reaches any real capability', () => {
    expect(checkAgentActionConfirmation({ risk: 'destructive', confirmed: false }).permitted).toBe(false);
    expect(() => assertAgentActionConfirmed({ risk: 'destructive', confirmed: false })).toThrow(
      AgentActionNotConfirmedError,
    );
  });

  it('permits a destructive action only with explicit confirmation', () => {
    expect(() => assertAgentActionConfirmed({ risk: 'destructive', confirmed: true })).not.toThrow();
  });

  it('never lets a standing permission satisfy a destructive action, confirmation every time', () => {
    const grant: AgentStandingPermission = {
      actionType: 'git.push',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      grantedAt: '2026-01-01T00:00:00.000Z',
      revoked: false,
    };
    expect(() =>
      assertAgentActionConfirmed({ risk: 'destructive', confirmed: false, standingPermission: grant }),
    ).toThrow(AgentActionNotConfirmedError);
  });

  it('blocks a remote action with no confirmation and no standing permission', () => {
    expect(checkAgentActionConfirmation({ risk: 'remote', confirmed: false }).permitted).toBe(false);
  });

  it('permits a remote action with explicit confirmation', () => {
    expect(checkAgentActionConfirmation({ risk: 'remote', confirmed: true }).permitted).toBe(true);
  });

  it('permits a remote action via a live, non-revoked standing permission', () => {
    const grant: AgentStandingPermission = {
      actionType: 'github.createPullRequest',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      grantedAt: '2026-01-01T00:00:00.000Z',
      revoked: false,
    };
    expect(
      checkAgentActionConfirmation({ risk: 'remote', confirmed: false, standingPermission: grant }).permitted,
    ).toBe(true);
  });

  it('blocks a remote action once its standing permission is revoked', () => {
    const grant: AgentStandingPermission = {
      actionType: 'github.createPullRequest',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      grantedAt: '2026-01-01T00:00:00.000Z',
      revoked: false,
    };
    const revoked = revokeStandingPermission(grant);
    expect(revoked.revoked).toBe(true);
    expect(
      checkAgentActionConfirmation({ risk: 'remote', confirmed: false, standingPermission: revoked }).permitted,
    ).toBe(false);
  });
});
