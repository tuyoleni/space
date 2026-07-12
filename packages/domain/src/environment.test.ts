import { describe, expect, it } from 'vitest';
import { buildEnvironment, type EnvironmentInput } from './environment';

const base: EnvironmentInput = {
  osBase: {
    PATH: '/usr/bin:/bin',
    HOME: '/Users/someone',
    AWS_SECRET_ACCESS_KEY: 'host-secret-should-not-leak',
    LANG: 'en_US.UTF-8',
  },
  machineToolPaths: { PATH: '/opt/space/tools:/usr/bin:/bin' },
  workspaceToolConfig: { GIT_CONFIG_GLOBAL: '/data/ws-1/git/config' },
  workspaceVars: { WS_NAME: 'client-a' },
  projectVars: { NODE_ENV: 'development' },
  secrets: { GH_TOKEN: 'secret-token' },
  operationVars: { SPACE_OPERATION_ID: 'op-123' },
  policy: {
    inheritAllowList: ['PATH', 'HOME', 'LANG'],
    denyList: ['AWS_SECRET_ACCESS_KEY'],
  },
};

describe('buildEnvironment (spec section 5.3)', () => {
  it('only inherits allow-listed host variables', () => {
    const env = buildEnvironment(base);
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.HOME).toBe('/Users/someone');
    expect(env.LANG).toBe('en_US.UTF-8');
  });

  it('lets later layers override earlier ones in the mandated order', () => {
    const env = buildEnvironment(base);
    expect(env.PATH).toBe('/opt/space/tools:/usr/bin:/bin');
    const withProjectOverride = buildEnvironment({
      ...base,
      projectVars: { WS_NAME: 'project-wins' },
    });
    expect(withProjectOverride.WS_NAME).toBe('project-wins');
  });

  it('applies the deny list even against later layers', () => {
    const env = buildEnvironment({
      ...base,
      operationVars: { AWS_SECRET_ACCESS_KEY: 'sneaky' },
    });
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it('is deterministic for identical input', () => {
    expect(buildEnvironment(base)).toEqual(buildEnvironment(base));
  });

  it('carries workspace git config and secrets into the final environment', () => {
    const env = buildEnvironment(base);
    expect(env.GIT_CONFIG_GLOBAL).toBe('/data/ws-1/git/config');
    expect(env.GH_TOKEN).toBe('secret-token');
    expect(env.SPACE_OPERATION_ID).toBe('op-123');
  });
});
