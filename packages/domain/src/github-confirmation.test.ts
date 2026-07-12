import { describe, expect, it } from 'vitest';
import { assertHighImpactGithubActionConfirmed, HighImpactGithubActionNotConfirmedError } from './github-confirmation';

describe('assertHighImpactGithubActionConfirmed', () => {
  it('throws when a PR merge is not confirmed', () => {
    expect(() => assertHighImpactGithubActionConfirmed({ action: 'merge-pull-request', confirmed: false })).toThrow(
      HighImpactGithubActionNotConfirmedError,
    );
  });

  it('throws when a release publish is not confirmed', () => {
    expect(() => assertHighImpactGithubActionConfirmed({ action: 'publish-release', confirmed: false })).toThrow(
      HighImpactGithubActionNotConfirmedError,
    );
  });

  it('passes when confirmed', () => {
    expect(() => assertHighImpactGithubActionConfirmed({ action: 'merge-pull-request', confirmed: true })).not.toThrow();
    expect(() => assertHighImpactGithubActionConfirmed({ action: 'publish-release', confirmed: true })).not.toThrow();
    expect(() =>
      assertHighImpactGithubActionConfirmed({ action: 'trigger-workflow-dispatch', confirmed: true }),
    ).not.toThrow();
    expect(() =>
      assertHighImpactGithubActionConfirmed({ action: 'trigger-release-workflow', confirmed: true }),
    ).not.toThrow();
  });

  it('reports the action on the error', () => {
    try {
      assertHighImpactGithubActionConfirmed({ action: 'publish-release', confirmed: false });
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HighImpactGithubActionNotConfirmedError);
      expect((error as HighImpactGithubActionNotConfirmedError).action).toBe('publish-release');
    }
  });
});
