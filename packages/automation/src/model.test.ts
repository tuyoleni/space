import { describe, expect, it } from 'vitest';
import {
  AutomationActionSchema,
  AutomationDefinitionSchema,
  InvalidAutomationActionError,
  parseAutomationAction,
  parseAutomationDefinition,
} from './model';

describe('AutomationActionSchema / parseAutomationAction', () => {
  it('accepts each of the exact seven V1 action types (spec 18.3)', () => {
    const actions = [
      { id: '1', type: 'runApprovedScript', parameters: { scriptName: 'build' } },
      { id: '2', type: 'runTests', parameters: {} },
      { id: '3', type: 'fetchRepository', parameters: {} },
      { id: '4', type: 'notifyUser', parameters: { message: 'hi' } },
      { id: '5', type: 'preparePrDescription', parameters: { title: 't', base: 'main', head: 'feature' } },
      { id: '6', type: 'triggerGithubWorkflow', parameters: { workflow: 'ci.yml', ref: 'main' } },
      { id: '7', type: 'openReceiptOrView', parameters: { view: 'activity' } },
    ];
    for (const action of actions) {
      expect(() => parseAutomationAction(action)).not.toThrow();
    }
  });

  it('rejects an action type outside the V1 set — there is no schema branch a destructive-shaped action (force-push, merge, release-publish, branch-delete) could ever satisfy', () => {
    const smuggled = { id: '1', type: 'git.push', parameters: { branch: 'main', force: 'raw' } };
    expect(() => parseAutomationAction(smuggled)).toThrow(InvalidAutomationActionError);

    const anotherAttempt = { id: '2', type: 'github.mergePullRequest', parameters: { number: 1 } };
    expect(() => parseAutomationAction(anotherAttempt)).toThrow(InvalidAutomationActionError);
  });

  it('rejects malformed parameters for a known action type', () => {
    expect(() => parseAutomationAction({ id: '1', type: 'notifyUser', parameters: {} })).toThrow();
    expect(() => parseAutomationAction({ id: '1', type: 'triggerGithubWorkflow', parameters: { ref: 'main' } })).toThrow();
  });

  it('AutomationActionSchema.safeParse mirrors parseAutomationAction', () => {
    const result = AutomationActionSchema.safeParse({ id: '1', type: 'runTests', parameters: {} });
    expect(result.success).toBe(true);
  });
});

describe('AutomationDefinitionSchema / parseAutomationDefinition', () => {
  const valid = {
    workspaceId: 'ws-1',
    projectId: null,
    name: 'Notify on failed checks',
    trigger: { type: 'check-failed' },
    conditions: [],
    actions: [{ id: '1', type: 'notifyUser', parameters: { message: 'A check failed' } }],
  };

  it('accepts a well-formed automation definition', () => {
    expect(() => parseAutomationDefinition(valid)).not.toThrow();
  });

  it('rejects a definition with zero actions', () => {
    expect(() => parseAutomationDefinition({ ...valid, actions: [] })).toThrow();
  });

  it('rejects an unknown trigger type', () => {
    expect(() => parseAutomationDefinition({ ...valid, trigger: { type: 'webhook-received' } })).toThrow();
  });

  it('accepts a scoped project-level automation', () => {
    expect(() => parseAutomationDefinition({ ...valid, projectId: 'proj-1' })).not.toThrow();
  });

  it('rejects an empty name', () => {
    expect(() => parseAutomationDefinition({ ...valid, name: '' })).toThrow();
  });
});
