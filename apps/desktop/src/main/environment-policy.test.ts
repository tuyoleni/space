import { describe, expect, it } from 'vitest';
import { buildSpaceEnvironment } from './environment-policy';

describe('buildSpaceEnvironment', () => {
  it('is never a raw process.env passthrough: drops unlisted host variables', () => {
    const env = buildSpaceEnvironment({ osBase: { PATH: '/usr/bin', SOME_RANDOM_HOST_VAR: 'leak' } });
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['SOME_RANDOM_HOST_VAR']).toBeUndefined();
  });

  it('strips known secret-shaped keys even if a layer tries to set them', () => {
    const env = buildSpaceEnvironment({ projectVars: { GITHUB_TOKEN: 'ghp_leak', SAFE_VAR: 'ok' } });
    expect(env['GITHUB_TOKEN']).toBeUndefined();
    expect(env['SAFE_VAR']).toBe('ok');
  });

  it('layers workspace and project vars on top of the inherited base', () => {
    const env = buildSpaceEnvironment({
      osBase: { PATH: '/usr/bin' },
      workspaceVars: { WORKSPACE_VAR: 'a' },
      projectVars: { PROJECT_VAR: 'b' },
    });
    expect(env).toMatchObject({ PATH: '/usr/bin', WORKSPACE_VAR: 'a', PROJECT_VAR: 'b' });
  });
});
