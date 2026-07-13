import { describe, expect, it } from 'vitest';
import type { Automation } from './model';
import {
  evaluateConditions,
  inScopeAutomations,
  isInScope,
  isScheduledAutomationDue,
  matchesTrigger,
  matchingAutomations,
  type AutomationTriggerEvent,
} from './trigger-matching';

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
    projectId: 'proj-1',
    occurredAt: '2026-01-01T00:00:00.000Z',
    context: {},
    ...overrides,
  };
}

describe('isInScope', () => {
  it('matches a workspace-wide automation to any project in that workspace', () => {
    expect(isInScope(baseAutomation({ projectId: null }), baseEvent())).toBe(true);
  });

  it('rejects a mismatched trigger type', () => {
    expect(isInScope(baseAutomation({ trigger: { type: 'branch-pushed' } }), baseEvent({ type: 'commit-created' }))).toBe(false);
  });

  it('rejects an event from a different workspace', () => {
    expect(isInScope(baseAutomation({ workspaceId: 'ws-1' }), baseEvent({ workspaceId: 'ws-2' }))).toBe(false);
  });

  it('rejects an event from a different project when the automation is project-scoped', () => {
    expect(isInScope(baseAutomation({ projectId: 'proj-1' }), baseEvent({ projectId: 'proj-2' }))).toBe(false);
  });

  it('matches a project-scoped automation to its exact project', () => {
    expect(isInScope(baseAutomation({ projectId: 'proj-1' }), baseEvent({ projectId: 'proj-1' }))).toBe(true);
  });
});

describe('evaluateConditions', () => {
  it('passes with no conditions', () => {
    expect(evaluateConditions([], {})).toBe(true);
  });

  it('evaluates equals/notEquals/contains/matches', () => {
    const context = { branch: 'main', checkName: 'build-and-test' };
    expect(evaluateConditions([{ field: 'branch', operator: 'equals', value: 'main' }], context)).toBe(true);
    expect(evaluateConditions([{ field: 'branch', operator: 'equals', value: 'dev' }], context)).toBe(false);
    expect(evaluateConditions([{ field: 'branch', operator: 'notEquals', value: 'dev' }], context)).toBe(true);
    expect(evaluateConditions([{ field: 'checkName', operator: 'contains', value: 'test' }], context)).toBe(true);
    expect(evaluateConditions([{ field: 'checkName', operator: 'matches', value: '^build' }], context)).toBe(true);
    expect(evaluateConditions([{ field: 'checkName', operator: 'matches', value: '^test' }], context)).toBe(false);
  });

  it('requires every condition to pass (logical AND)', () => {
    const context = { branch: 'main', checkName: 'build' };
    expect(
      evaluateConditions(
        [
          { field: 'branch', operator: 'equals', value: 'main' },
          { field: 'checkName', operator: 'equals', value: 'lint' },
        ],
        context,
      ),
    ).toBe(false);
  });

  it('never throws on an invalid user-authored regex — it just does not match', () => {
    expect(evaluateConditions([{ field: 'branch', operator: 'matches', value: '(' }], { branch: 'main' })).toBe(false);
  });
});

describe('matchesTrigger / matchingAutomations', () => {
  it('excludes a disabled automation even if everything else matches', () => {
    const automation = baseAutomation({ enabled: false });
    expect(matchesTrigger(automation, baseEvent())).toBe(false);
  });

  it('includes an enabled, in-scope automation with passing conditions', () => {
    const automation = baseAutomation({ conditions: [{ field: 'branch', operator: 'equals', value: 'main' }] });
    expect(matchesTrigger(automation, baseEvent({ context: { branch: 'main' } }))).toBe(true);
    expect(matchesTrigger(automation, baseEvent({ context: { branch: 'dev' } }))).toBe(false);
  });

  it('filters a list preserving order', () => {
    const a1 = baseAutomation({ id: 'a1' });
    const a2 = baseAutomation({ id: 'a2', enabled: false });
    const a3 = baseAutomation({ id: 'a3' });
    expect(matchingAutomations([a1, a2, a3], baseEvent()).map((a) => a.id)).toEqual(['a1', 'a3']);
  });
});

describe('inScopeAutomations', () => {
  it('includes an in-scope, enabled automation even when its conditions would fail — condition evaluation is the engine\'s job, not this filter\'s', () => {
    const automation = baseAutomation({ conditions: [{ field: 'branch', operator: 'equals', value: 'main' }] });
    expect(inScopeAutomations([automation], baseEvent({ context: { branch: 'dev' } })).map((a) => a.id)).toEqual(['auto-1']);
  });

  it('excludes a disabled automation', () => {
    const automation = baseAutomation({ enabled: false });
    expect(inScopeAutomations([automation], baseEvent())).toEqual([]);
  });

  it('excludes an automation whose trigger type or scope does not match', () => {
    const wrongTrigger = baseAutomation({ trigger: { type: 'branch-pushed' } });
    const wrongProject = baseAutomation({ projectId: 'proj-2' });
    expect(inScopeAutomations([wrongTrigger, wrongProject], baseEvent({ projectId: 'proj-1' }))).toEqual([]);
  });
});

describe('isScheduledAutomationDue', () => {
  const scheduled = baseAutomation({ trigger: { type: 'scheduled', intervalMinutes: 30 } });

  it('is due immediately for a never-run automation', () => {
    expect(isScheduledAutomationDue(scheduled, new Date('2026-01-01T00:00:00.000Z'), null)).toBe(true);
  });

  it('is not due before the interval elapses', () => {
    expect(isScheduledAutomationDue(scheduled, new Date('2026-01-01T00:10:00.000Z'), '2026-01-01T00:00:00.000Z')).toBe(false);
  });

  it('is due once the interval elapses', () => {
    expect(isScheduledAutomationDue(scheduled, new Date('2026-01-01T00:30:00.000Z'), '2026-01-01T00:00:00.000Z')).toBe(true);
  });

  it('is never due for a disabled automation or a non-scheduled trigger', () => {
    expect(isScheduledAutomationDue({ ...scheduled, enabled: false }, new Date(), null)).toBe(false);
    expect(isScheduledAutomationDue(baseAutomation({ trigger: { type: 'commit-created' } }), new Date(), null)).toBe(false);
  });
});
