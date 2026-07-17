import { describe, expect, it } from 'vitest';
import { DestructiveGitActionNotConfirmedError, assertDestructiveGitActionConfirmed } from './git-confirmation';

describe('assertDestructiveGitActionConfirmed', () => {
  it('throws when the action was not confirmed', () => {
    expect(() => assertDestructiveGitActionConfirmed({ action: 'delete-branch', confirmed: false })).toThrow(
      DestructiveGitActionNotConfirmedError,
    );
  });

  it('passes when the action was confirmed', () => {
    expect(() => assertDestructiveGitActionConfirmed({ action: 'delete-branch', confirmed: true })).not.toThrow();
  });

  it('passes force-push-with-lease when confirmed, without needing a policy gate', () => {
    expect(() =>
      assertDestructiveGitActionConfirmed({ action: 'force-push-with-lease', confirmed: true }),
    ).not.toThrow();
  });

  it('blocks raw force push even when confirmed unless the policy gate explicitly allows it', () => {
    expect(() => assertDestructiveGitActionConfirmed({ action: 'force-push-raw', confirmed: true })).toThrow(
      DestructiveGitActionNotConfirmedError,
    );
    expect(() =>
      assertDestructiveGitActionConfirmed({ action: 'force-push-raw', confirmed: true }, true),
    ).not.toThrow();
  });

  it('blocks raw force push when unconfirmed regardless of policy', () => {
    expect(() =>
      assertDestructiveGitActionConfirmed({ action: 'force-push-raw', confirmed: false }, true),
    ).toThrow(DestructiveGitActionNotConfirmedError);
  });

  it('throws when a branch merge was not confirmed', () => {
    expect(() => assertDestructiveGitActionConfirmed({ action: 'merge-branch', confirmed: false })).toThrow(
      DestructiveGitActionNotConfirmedError,
    );
  });

  it('passes a branch merge when confirmed', () => {
    expect(() => assertDestructiveGitActionConfirmed({ action: 'merge-branch', confirmed: true })).not.toThrow();
  });
});
