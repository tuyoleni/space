import { describe, expect, it } from 'vitest';
import { activityEventFromOperation, type OperationLike } from './from-operation';

function op(overrides: Partial<OperationLike>): OperationLike {
  return {
    type: 'git.commit',
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    humanSummary: 'Commit "fix bug"',
    endedAt: '2026-07-12T10:00:00.000Z',
    state: 'succeeded',
    ...overrides,
  };
}

describe('activityEventFromOperation (spec 17.1 ACT-001)', () => {
  it('maps a mapped, succeeded operation type to a real activity event', () => {
    const result = activityEventFromOperation(op({}));
    expect(result).toEqual({
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      eventType: 'commit',
      occurredAt: '2026-07-12T10:00:00.000Z',
      subjectRef: null,
      summary: 'Commit "fix bug"',
      weight: 3,
      metadata: null,
    });
  });

  it('carries a subjectRef through when the caller supplies one (e.g. a commit SHA)', () => {
    const result = activityEventFromOperation(op({ subjectRef: 'abc123' }));
    expect(result?.subjectRef).toBe('abc123');
  });

  it('never produces an event for a failed operation, even if the type is mapped', () => {
    expect(activityEventFromOperation(op({ state: 'failed' }))).toBeNull();
  });

  it('never produces an event for an operation type with no activity mapping', () => {
    expect(activityEventFromOperation(op({ type: 'project.detect' }))).toBeNull();
  });

  it('never produces an event with no workspace to attribute it to', () => {
    expect(activityEventFromOperation(op({ workspaceId: null }))).toBeNull();
  });

  it('never produces an event that has not actually ended yet', () => {
    expect(activityEventFromOperation(op({ endedAt: null }))).toBeNull();
  });

  it('maps every operation type project-handlers.ts and git-handlers.ts are expected to emit', () => {
    const types = [
      'workspace.create',
      'workspace.activate',
      'project.add',
      'project.createFromTemplate',
      'project.clone',
      'project.installDependencies',
      'project.devServer.start',
      'project.devServer.stop',
      'git.init',
      'git.commit',
      'git.branch.create',
      'git.branch.switch',
      'git.branch.delete',
      'git.fetch',
      'git.pull',
      'git.push',
    ];
    for (const type of types) {
      expect(activityEventFromOperation(op({ type }))).not.toBeNull();
    }
  });
});
