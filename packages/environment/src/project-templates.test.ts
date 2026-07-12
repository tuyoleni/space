import { describe, expect, it } from 'vitest';
import { BUILT_IN_PROJECT_TEMPLATES, NODE_MINIMAL_TEMPLATE, detectDevScript, findProjectTemplate } from './project-templates';

describe('findProjectTemplate', () => {
  it('finds the built-in node-minimal template', () => {
    expect(findProjectTemplate('node-minimal')?.id).toBe('node-minimal');
  });

  it('returns null for an unknown template id', () => {
    expect(findProjectTemplate('does-not-exist')).toBeNull();
  });

  it('every built-in template declares a non-interactive creation command', () => {
    for (const template of BUILT_IN_PROJECT_TEMPLATES) {
      const command = template.creationCommand({}, 'my-app');
      expect(command.executable.length).toBeGreaterThan(0);
      expect(Array.isArray(command.args)).toBe(true);
    }
  });
});

describe('NODE_MINIMAL_TEMPLATE', () => {
  it('creation command is exactly npm init --yes (non-interactive)', () => {
    expect(NODE_MINIMAL_TEMPLATE.creationCommand({}, 'my-app')).toEqual({
      executable: 'npm',
      args: ['init', '--yes'],
    });
  });

  it('has no dev command, since a bare npm init produces no dev script', () => {
    expect(NODE_MINIMAL_TEMPLATE.devCommand).toBeNull();
  });
});

describe('detectDevScript', () => {
  it('prefers "dev" over "start"', () => {
    expect(detectDevScript({ dev: 'vite', start: 'node index.js' })).toBe('dev');
  });

  it('falls back to "start" when there is no "dev" script', () => {
    expect(detectDevScript({ start: 'node index.js' })).toBe('start');
  });

  it('returns null when there are no scripts at all', () => {
    expect(detectDevScript(undefined)).toBeNull();
    expect(detectDevScript({})).toBeNull();
    expect(detectDevScript({ build: 'tsc' })).toBeNull();
  });
});
