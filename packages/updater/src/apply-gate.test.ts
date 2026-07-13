import { describe, expect, it } from 'vitest';
import { evaluateApplyGate } from './apply-gate';

const clean = { hasRunningInstallation: false, hasInFlightGitMutation: false, hasUnrecoverableOperation: false, pendingLocalMigrationCount: 0 };

describe('evaluateApplyGate (spec 31.3)', () => {
  it('allows applying when nothing is running and no migrations are pending', () => {
    expect(evaluateApplyGate(clean)).toEqual({ canApplyNow: true, blockingReasons: [] });
  });

  it('blocks on a running installation', () => {
    const decision = evaluateApplyGate({ ...clean, hasRunningInstallation: true });
    expect(decision.canApplyNow).toBe(false);
    expect(decision.blockingReasons).toEqual(['a tool installation is currently running']);
  });

  it('blocks on an in-flight Git mutation', () => {
    const decision = evaluateApplyGate({ ...clean, hasInFlightGitMutation: true });
    expect(decision.canApplyNow).toBe(false);
    expect(decision.blockingReasons).toEqual(['a Git mutation is currently in flight']);
  });

  it('blocks on an unrecoverable operation', () => {
    const decision = evaluateApplyGate({ ...clean, hasUnrecoverableOperation: true });
    expect(decision.canApplyNow).toBe(false);
  });

  it('blocks when local migrations are still pending from a previous update', () => {
    const decision = evaluateApplyGate({ ...clean, pendingLocalMigrationCount: 2 });
    expect(decision.canApplyNow).toBe(false);
    expect(decision.blockingReasons).toEqual(['2 local database migration(s) are still pending from a previous update']);
  });

  it('reports every blocking reason at once, not just the first', () => {
    const decision = evaluateApplyGate({
      hasRunningInstallation: true,
      hasInFlightGitMutation: true,
      hasUnrecoverableOperation: false,
      pendingLocalMigrationCount: 1,
    });
    expect(decision.blockingReasons).toHaveLength(3);
  });
});
