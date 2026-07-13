import { describe, expect, it, vi } from 'vitest';
import { AgentActionNotConfirmedError, type AgentStandingPermission } from '@space/domain';
import { computeIntrinsicRisk, dispatchAgentAction, type AgentActionHandlers } from './dispatch';

function baseFields(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    explanation: 'because reasons',
    risk: 'observe', // deliberately often "wrong" below — dispatch must not trust this field
    ...overrides,
  };
}

function noopHandlers(overrides: Partial<AgentActionHandlers> = {}): AgentActionHandlers {
  const fail = vi.fn(async () => {
    throw new Error('handler should not have been called');
  });
  return {
    fileRead: fail,
    fileModify: fail,
    installDependencies: fail,
    runScript: fail,
    gitStage: fail,
    gitCommit: fail,
    gitPush: fail,
    githubCreatePullRequest: fail,
    ...overrides,
  };
}

describe('computeIntrinsicRisk', () => {
  it('never trusts the action-supplied risk label', () => {
    const action = { type: 'git.push' as const, parameters: { branch: 'main' } };
    // Claims destructive in its own envelope elsewhere is irrelevant; computeIntrinsicRisk only looks at type/parameters.
    expect(computeIntrinsicRisk(action)).toBe('remote');
  });

  it('classifies a plain git.push as remote', () => {
    expect(computeIntrinsicRisk({ type: 'git.push', parameters: { branch: 'main' } })).toBe('remote');
  });

  it('classifies a force-with-lease git.push as destructive even though the model might label it otherwise', () => {
    expect(computeIntrinsicRisk({ type: 'git.push', parameters: { branch: 'main', force: 'with-lease' } })).toBe(
      'destructive',
    );
  });

  it('classifies a raw-force git.push as destructive', () => {
    expect(computeIntrinsicRisk({ type: 'git.push', parameters: { branch: 'main', force: 'raw' } })).toBe(
      'destructive',
    );
  });

  it('classifies file.read as observe and file.modify as local-reversible', () => {
    expect(computeIntrinsicRisk({ type: 'file.read', parameters: { path: 'a.txt' } })).toBe('observe');
    expect(computeIntrinsicRisk({ type: 'file.modify', parameters: { patchText: 'x' } })).toBe('local-reversible');
  });

  it('classifies github.createPullRequest as remote', () => {
    expect(
      computeIntrinsicRisk({
        type: 'github.createPullRequest',
        parameters: { title: 't', body: 'b', base: 'main', head: 'feature' },
      }),
    ).toBe('remote');
  });
});

describe('dispatchAgentAction: structural confirmation gate', () => {
  it('rejects an unconfirmed force-push action before the git handler is ever called, regardless of the plan\'s own risk label', async () => {
    const gitPush = vi.fn(async () => ({ ok: true }));
    const handlers = noopHandlers({ gitPush });
    const action = {
      ...baseFields({ risk: 'observe' }), // a malicious/broken plan mislabels a destructive action as harmless
      type: 'git.push',
      parameters: { branch: 'main', force: 'raw' },
    };

    await expect(dispatchAgentAction(action, handlers, { confirmed: false })).rejects.toThrow(
      AgentActionNotConfirmedError,
    );
    expect(gitPush).not.toHaveBeenCalled();
  });

  it('permits a confirmed force-push action and calls through to the real handler', async () => {
    const gitPush = vi.fn(async () => ({ ok: true }));
    const handlers = noopHandlers({ gitPush });
    const action = {
      ...baseFields(),
      type: 'git.push',
      parameters: { branch: 'main', force: 'raw' },
    };

    const result = await dispatchAgentAction(action, handlers, { confirmed: true });
    expect(result).toEqual({ ok: true });
    expect(gitPush).toHaveBeenCalledTimes(1);
  });

  it('rejects an unconfirmed remote action (plain push) with no standing permission', async () => {
    const gitPush = vi.fn(async () => ({ ok: true }));
    const handlers = noopHandlers({ gitPush });
    const action = { ...baseFields(), type: 'git.push', parameters: { branch: 'main' } };

    await expect(dispatchAgentAction(action, handlers, { confirmed: false })).rejects.toThrow(
      AgentActionNotConfirmedError,
    );
    expect(gitPush).not.toHaveBeenCalled();
  });

  it('permits a remote action via a live standing permission without requiring per-call confirmation', async () => {
    const githubCreatePullRequest = vi.fn(async () => ({ url: 'https://example.com/pr/1' }));
    const handlers = noopHandlers({ githubCreatePullRequest });
    const action = {
      ...baseFields(),
      type: 'github.createPullRequest',
      parameters: { title: 't', body: 'b', base: 'main', head: 'feature' },
    };
    const grant: AgentStandingPermission = {
      actionType: 'github.createPullRequest',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      grantedAt: '2026-01-01T00:00:00.000Z',
      revoked: false,
    };

    const result = await dispatchAgentAction(action, handlers, { confirmed: false, standingPermission: grant });
    expect(result).toEqual({ url: 'https://example.com/pr/1' });
  });

  it('never lets a standing permission substitute for confirmation on a destructive action', async () => {
    const gitPush = vi.fn(async () => ({ ok: true }));
    const handlers = noopHandlers({ gitPush });
    const action = { ...baseFields(), type: 'git.push', parameters: { branch: 'main', force: 'raw' } };
    const grant: AgentStandingPermission = {
      actionType: 'git.push',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      grantedAt: '2026-01-01T00:00:00.000Z',
      revoked: false,
    };

    await expect(dispatchAgentAction(action, handlers, { confirmed: false, standingPermission: grant })).rejects.toThrow(
      AgentActionNotConfirmedError,
    );
    expect(gitPush).not.toHaveBeenCalled();
  });

  it('permits observe/local-reversible actions without any confirmation flag', async () => {
    const gitCommit = vi.fn(async () => ({ sha: 'abc123' }));
    const handlers = noopHandlers({ gitCommit });
    const action = { ...baseFields(), type: 'git.commit', parameters: { message: 'commit message' } };

    const result = await dispatchAgentAction(action, handlers, { confirmed: false });
    expect(result).toEqual({ sha: 'abc123' });
  });

  it('rejects malformed input before it reaches any handler (schema validation boundary, spec 19.3)', async () => {
    const gitCommit = vi.fn(async () => ({ sha: 'abc123' }));
    const handlers = noopHandlers({ gitCommit });
    const malformed = { ...baseFields(), type: 'git.commit', parameters: { notMessage: 'x' } };

    await expect(dispatchAgentAction(malformed, handlers, { confirmed: true })).rejects.toThrow();
    expect(gitCommit).not.toHaveBeenCalled();
  });

  it('rejects a completely unknown action type rather than passing it through to any handler', async () => {
    const handlers = noopHandlers();
    const malicious = { ...baseFields({ risk: 'destructive' }), type: 'shell.runAnyCommand', parameters: { command: 'rm -rf /' } };

    await expect(dispatchAgentAction(malicious, handlers, { confirmed: true })).rejects.toThrow();
  });
});
