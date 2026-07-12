import { describe, expect, it } from 'vitest';
import { buildGithubCredentialRef, GITHUB_CREDENTIAL_SERVICE } from './credential';

describe('buildGithubCredentialRef', () => {
  it('is deterministic and scoped to workspace + host, using the Space-owned service identifier', () => {
    expect(buildGithubCredentialRef('ws-1', 'github.com')).toEqual({ service: GITHUB_CREDENTIAL_SERVICE, account: 'ws-1:github.com' });
  });

  it('never collides two different workspaces on the same host', () => {
    const a = buildGithubCredentialRef('ws-1', 'github.com');
    const b = buildGithubCredentialRef('ws-2', 'github.com');
    expect(a.account).not.toBe(b.account);
  });
});
